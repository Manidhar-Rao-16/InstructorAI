import asyncio
from datetime import timedelta, date, datetime
from sqlalchemy import select
from db.database import AsyncSessionLocal
from db.models import LearningSession, LearningStep

async def fix_old_dates():
    async with AsyncSessionLocal() as db:
        sessions_res = await db.execute(select(LearningSession).where(LearningSession.status != "completed"))
        sessions = sessions_res.scalars().all()
        
        for session in sessions:
            steps_res = await db.execute(
                select(LearningStep)
                .where(LearningStep.session_id == session.id)
                .order_by(LearningStep.step_number.asc())
            )
            steps = steps_res.scalars().all()
            
            if not steps:
                continue
            
            try:
                # Find start date from the first step
                if steps[0].target_date:
                    start_date = datetime.strptime(steps[0].target_date, "%Y-%m-%d").date()
                else:
                    start_date = date.today()
            except Exception:
                start_date = date.today()
                
            current_date = start_date
            
            for step in steps:
                # Skip Sundays
                while current_date.weekday() == 6:
                    current_date += timedelta(days=1)
                    
                step.target_date = current_date.isoformat()
                current_date += timedelta(days=1)
                
        await db.commit()
        print(f"Fixed {len(sessions)} active sessions.")

if __name__ == "__main__":
    asyncio.run(fix_old_dates())
