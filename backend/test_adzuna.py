import os
import requests
from dotenv import load_dotenv

load_dotenv()

APP_ID = os.getenv("ADZUNA_APP_ID")
APP_KEY = os.getenv("ADZUNA_APP_KEY")
COUNTRY = os.getenv("ADZUNA_COUNTRY", "gb")

url = f"https://api.adzuna.com/v1/api/jobs/{COUNTRY}/search/1"

params = {
    "app_id": APP_ID,
    "app_key": APP_KEY,
    "what": "Cloud Engineer",
    "where": "London",
    "results_per_page": 5,
    "content-type": "application/json",
}

response = requests.get(url, params=params, timeout=20)

print("Status code:", response.status_code)
print("Response preview:")
print(response.text[:1000])