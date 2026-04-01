#!/bin/bash

# Port to check
PORT=8000

echo "🚀 Preparing InstructorAI Backend..."

# 1. Kill any existing process on port 8000
PID=$(lsof -ti :$PORT)
if [ ! -z "$PID" ]; then
    echo "⚠️  Found existing process on port $PORT (PID: $PID). Cleaning up..."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null
    sleep 1
fi

# 2. Check if venv exists
if [ ! -d "venv" ]; then
    echo "❌ Error: Virtual environment (venv) not found. Please create it first."
    exit 1
fi

# 3. Start server using the virtual environment
echo "✅ Starting server on http://localhost:$PORT using venv..."
./venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port $PORT

