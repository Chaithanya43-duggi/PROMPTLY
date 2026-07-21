import sys
import os
import asyncio

# Adjust import path to find app module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.local_nlp import analyze_local

async def test_opener_indices():
    prompt = "write a description for an image"
    issues = await analyze_local(prompt)
    assert len(issues) > 0
    opener_issue = issues[0]
    
    assert opener_issue.start_idx == 0
    assert opener_issue.end_idx == 7  # len("write a")
    assert opener_issue.target_text == "write a"
    print("[OK] Weak opener index test passed!")

async def test_short_length_indices():
    prompt = "hi"
    issues = await analyze_local(prompt)
    assert len(issues) > 0
    length_issue = next(i for i in issues if i.category == "Context")
    
    assert length_issue.start_idx == 0
    assert length_issue.end_idx == 2
    assert length_issue.target_text == "hi"
    print("[OK] Length coordinate verification passed!")

async def main():
    await test_opener_indices()
    await test_short_length_indices()
    print("All backend coordinate calculations verified successfully!")

if __name__ == "__main__":
    asyncio.run(main())
