import requests
import json

base_url = 'http://localhost:1347/webhook/gitea'
headers = {'Content-Type': 'application/json'}

repos = [
    { "full_name": "oa-java/oa-order", "clone_url": "https://code.9ji.com/oa-java/oa-order.git" },
    { "full_name": "group-logistics/oa-stock", "clone_url": "https://code.9ji.com/group-logistics/oa-stock.git" },
    { "full_name": "OA_CSharp/oanew", "clone_url": "https://code.9ji.com/OA_CSharp/oanew.git" }
]

for repo in repos:
    payload = {
        'repository': repo,
        'ref': 'refs/heads/master'
    }
    print(f'Triggering {repo["full_name"]}...')
    try:
        r = requests.post(base_url, headers=headers, json=payload)
        print(f'Status: {r.status_code}, Response: {r.text}')
    except Exception as e:
        print(f'Error: {e}')
