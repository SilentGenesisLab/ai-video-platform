import asyncio
import os
import sys
import uvicorn

if __name__ == '__main__':
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    config = uvicorn.Config('agent.main:app', host=os.getenv('AGENT_HOST', '127.0.0.1'), port=int(os.getenv('AGENT_PORT', '8107')), loop='asyncio')
    server = uvicorn.Server(config)
    asyncio.run(server.serve())
