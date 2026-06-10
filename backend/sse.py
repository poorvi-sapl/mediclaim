"""In-process SSE broker for plan-dashboard alert fan-out.

POST /actions calls broadcast_alert() (from a sync request thread);
GET /plan/alerts/stream uses subscribe()/unsubscribe() to stream events.
Each subscriber gets its own asyncio.Queue; broadcast_alert() pushes
thread-safely onto each subscriber's event loop.
"""

import asyncio


class SSEBroker:
    def __init__(self):
        # queue -> the event loop that owns it
        self._subscribers: dict[asyncio.Queue, asyncio.AbstractEventLoop] = {}

    async def subscribe(self) -> asyncio.Queue:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[queue] = loop
        return queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.pop(queue, None)

    def publish(self, event: dict) -> None:
        """Fan an event out to all subscribers. Safe to call from any thread."""
        for queue, loop in list(self._subscribers.items()):
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:
                # loop closed / subscriber gone — drop it
                self._subscribers.pop(queue, None)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


broker = SSEBroker()


def broadcast_alert(event: dict) -> None:
    """Module-level entry point used by POST /actions."""
    broker.publish(event)
