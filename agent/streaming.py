"""Accumulate OpenAI-compatible SSE, including split tool arguments. Never expose reasoning."""
import asyncio
import json
import time


async def stream_completion(client, url, headers, payload, emit, stopped):
    async def consume():
        message = {"role": "assistant", "content": ""}
        calls = {}
        pending = ""
        last_flush = time.monotonic()
        finished = False
        async with client.stream("POST", url, headers=headers, json={**payload, "stream": True}, timeout=180) as response:
            if response.is_error:
                # Cache the error body before the streaming context closes so the
                # caller can report pricing/credit failures and pause safely.
                await response.aread()
            response.raise_for_status()
            async for line in response.aiter_lines():
                if stopped.is_set():
                    raise asyncio.CancelledError()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    finished = True
                    break
                if not data:
                    continue
                chunk = json.loads(data)
                if "error" in chunk:
                    raise ValueError("Provider stream error")
                for choice in chunk.get("choices", []):
                    delta = choice.get("delta", {})
                    content = delta.get("content") or ""
                    message["content"] += content
                    pending += content
                    if delta.get("reasoning_content"):
                        message["reasoning_content"] = message.get("reasoning_content", "") + delta["reasoning_content"]
                    for call in delta.get("tool_calls", []):
                        item = calls.setdefault(call["index"], {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                        if call.get("id"):
                            item["id"] += call["id"]
                        for key in ("name", "arguments"):
                            item["function"][key] += call.get("function", {}).get(key) or ""
                if pending and (time.monotonic() - last_flush >= .12 or len(pending) >= 256):
                    await emit(pending)
                    pending = ""
                    last_flush = time.monotonic()
            if pending:
                await emit(pending)
        if not finished:
            raise ValueError("Incomplete provider stream")
        if calls:
            ordered = [calls[i] for i in sorted(calls)]
            for call in ordered:
                if not call["id"] or not call["function"]["name"]:
                    raise ValueError("Incomplete tool call")
                args = json.loads(call["function"]["arguments"])
                if not isinstance(args, dict):
                    raise ValueError("Tool arguments must be an object")
            message["tool_calls"] = ordered
        return message

    task = asyncio.create_task(consume())
    cancel = asyncio.create_task(stopped.wait())
    try:
        await asyncio.wait([task, cancel], return_when=asyncio.FIRST_COMPLETED)
        if stopped.is_set():
            task.cancel()
            raise asyncio.CancelledError()
        return await task
    finally:
        cancel.cancel()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, cancel, return_exceptions=True)
