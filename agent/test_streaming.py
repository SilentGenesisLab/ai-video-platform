import asyncio
import json
import httpx
import pytest
from streaming import stream_completion


class Frames(httpx.AsyncByteStream):
    def __init__(self, deltas, done=True):
        self.deltas, self.done = deltas, done

    async def __aiter__(self):
        for delta in self.deltas:
            yield ('data: ' + json.dumps({'choices': [{'delta': delta}]}) + '\n\n').encode()
        if self.done:
            yield b'data: [DONE]\n\n'


def run_stream(deltas, done=True, stop=False):
    async def check():
        output = []
        stopped = asyncio.Event()
        async def emit(text):
            output.append(text)
            if stop:
                stopped.set()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=Frames(deltas, done)))) as client:
            result = await stream_completion(client, 'https://fixture.test/chat/completions', {}, {}, emit, stopped)
        return result, output
    return asyncio.run(check())


def test_stream_emits_before_completion_without_reasoning():
    message, output = run_stream([{'reasoning_content': 'private reasoning'}, {'content': 'A' * 300}, {'content': 'B' * 300}])
    assert output == ['A' * 300, 'B' * 300]
    assert message['reasoning_content'] == 'private reasoning'


def test_stream_accumulates_tool_call_fragments():
    message, _ = run_stream([{'tool_calls': [{'index': 0, 'id': 'call_1', 'function': {'name': 'web_search', 'arguments': '{"que'}}]}, {'tool_calls': [{'index': 0, 'function': {'arguments': 'ry":"hello"}'}}]}])
    assert json.loads(message['tool_calls'][0]['function']['arguments']) == {'query': 'hello'}


def test_incomplete_tool_json_is_never_executed():
    with pytest.raises(ValueError):
        run_stream([{'tool_calls': [{'index': 0, 'id': 'call_1', 'function': {'name': 'web_search', 'arguments': '{"query":'}}]}])


def test_missing_done_is_an_interrupted_attempt():
    with pytest.raises(ValueError, match='Incomplete provider stream'):
        run_stream([{'content': 'partial'}], done=False)


def test_stop_cancels_stream_consumption():
    with pytest.raises(asyncio.CancelledError):
        run_stream([{'content': 'A' * 300}, {'content': 'must not arrive'}], stop=True)
