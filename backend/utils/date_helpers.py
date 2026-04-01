from datetime import datetime, timedelta
from typing import Set

# Hardcoded Indian National Holidays for 2026-2027
# Sourced from the ROADMAP_PROMPT definition.
INDIAN_HOLIDAYS_STR = {
    "2026-01-26", "2026-03-04", "2026-04-03", "2026-04-14", "2026-05-01", 
    "2026-08-15", "2026-10-02", "2026-12-25", "2027-01-26", "2027-03-04", 
    "2027-04-03", "2027-04-14", "2027-05-01", "2027-08-15", "2027-10-02", 
    "2027-12-25"
}

def is_holiday_or_sunday(dt: datetime) -> bool:
    """Returns True if the given datetime is a Sunday or an Indian holiday."""
    # Sunday is 6 in Python's weekday() (Monday=0, Sunday=6)
    if dt.weekday() == 6:
        return True
    
    date_str = dt.strftime("%Y-%m-%d")
    if date_str in INDIAN_HOLIDAYS_STR:
        return True
        
    return False

def get_next_working_day(current_date: datetime) -> datetime:
    """
    Given a date, return the *next* valid working day 
    (skipping Sundays and Indian National Holidays).
    """
    next_day = current_date + timedelta(days=1)
    while is_holiday_or_sunday(next_day):
        next_day += timedelta(days=1)
    return next_day

def shift_dates_forward(date_str: str, days: int = 1) -> str:
    """
    Pushes a given string date (YYYY-MM-DD) forward by 'days' working days.
    """
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        for _ in range(days):
            dt = get_next_working_day(dt)
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        # If the date is malformed or invalid, safely return the original
        return date_str
