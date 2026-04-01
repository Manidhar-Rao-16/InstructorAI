import asyncio
import sys
import os

# Add backend to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)) + '/../')

from config import settings
from agents.orchestrator import _get_openai_client, ASSIGNMENT_EVALUATOR_PROMPT, build_agents, _safe_run_agent

async def main():
    agents = build_agents()
    evaluator = agents["assignment_evaluator"]
    prompt = "Please evaluate this submission. Title: Test. Type: text. Content: def foo(): return 1\nFormat: {\"score\": 99, \"improvements_summary\": \"...\"}"
    print(f"Running agent...")
    try:
        res = await _safe_run_agent(evaluator, prompt)
        print("Success!")
        for msg in res.messages:
            print("MSG:", getattr(msg, "content", None))
    except Exception as e:
        print(f"Exception: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(main())
