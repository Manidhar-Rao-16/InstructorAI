import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)) + '/../')
from db.database import AsyncSessionLocal
from routers.assignment_router import _evaluate_assignment

async def main():
    async with AsyncSessionLocal() as db:
        content = "def add(a, b): return a + b"
        result = await _evaluate_assignment(db, 1, content, "Test Assignment", "Python Basics")
        print("RESULT:")
        print(result)

if __name__ == "__main__":
    asyncio.run(main())
