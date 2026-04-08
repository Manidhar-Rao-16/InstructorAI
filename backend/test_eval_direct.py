import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)) + '/../')
from db.database import AsyncSessionLocal
from routers.assignment_router import _evaluate_assignment

async def main():
    async with AsyncSessionLocal() as db:
        content = """
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

data = pd.DataFrame({'Species': ['Setosa', 'Setosa', 'Versicolor', 'Virginica'], 'SepalLength': [5.1, 4.9, 7.0, 6.3]})

plt.figure(figsize=(10, 6))
sns.histplot(data=data, x='SepalLength', kde=True, bins=10)
plt.title('Distribution of Sepal Length')
plt.xlabel('Sepal Length')
plt.ylabel('Frequency')
plt.show()

sns.boxplot(x='Species', y='SepalLength', data=data)
plt.title('Boxplot of Sepal Length by Species')
plt.show()
"""
        title = "Data Visualization with Matplotlib/Seaborn"
        topic = "Python for Data Science"
        prev_score = 60.0
        prev_feedback = "You should use Seaborn instead of just Matplotlib."
        result = await _evaluate_assignment(
            db, 1, content, title, topic, 
            previous_score=prev_score, previous_feedback=prev_feedback
        )
        print("RESULT FROM EVAL: ", result["score"])

if __name__ == "__main__":
    asyncio.run(main())
