import asyncio
import httpx

async def main():
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post("http://localhost:8000/api/auth/signup", json={"email": "tester6@test.com", "password": "password", "name": "tester6"})
        res = await client.post("http://localhost:8000/api/auth/login", json={"email": "tester6@test.com", "password": "password"})
        
        data = res.json()
        token = data.get("access_token")
        if not token:
            print("Login failed:", data)
            return
            
        headers = {"Authorization": f"Bearer {token}"}
        submit_data = {
            "title": "Test Assignment",
            "content": "This is a test submission."
        }
        res2 = await client.post("http://localhost:8000/api/tasks/submit/text", json=submit_data, headers=headers)
        print("STATUS:", res2.status_code)
        if res2.status_code != 200:
            print("ERROR_TEXT:", res2.text)

asyncio.run(main())
