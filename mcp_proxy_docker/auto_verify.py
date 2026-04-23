import requests
import time
import sys
import json

# 配置
BASE_URL = "http://localhost:1347/webhook/gitea"
API_URL = "http://localhost:1349/api/repos"
REPOS = [
    { "full_name": "oa-java/oa-order", "clone_url": "https://code.9ji.com/oa-java/oa-order.git" },
    { "full_name": "group-logistics/oa-stock", "clone_url": "https://code.9ji.com/group-logistics/oa-stock.git" },
    { "full_name": "OA_CSharp/oanew", "clone_url": "https://code.9ji.com/OA_CSharp/oanew.git" }
]

def wait_for_ready(url, name, timeout=60):
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(url, timeout=2)
            if r.status_code < 500:
                print(f"服务 {name} 已就绪 ({url})")
                return True
        except:
            pass
        time.sleep(2)
    print(f"错误: 服务 {name} 启动超时")
    return False

def trigger_all():
    print("--- 开始触发 Webhooks ---")
    for repo in REPOS:
        payload = {
            "repository": repo,
            "ref": "refs/heads/master"
        }
        try:
            r = requests.post(BASE_URL, json=payload, timeout=5)
            print(f"触发 {repo['full_name']}: {r.status_code}, {r.text}")
        except Exception as e:
            print(f"触发 {repo['full_name']} 失败: {e}")

def monitor_indexing(timeout=3600):
    print("--- 开始监控索引进度 (超时时间: 1小时) ---")
    start = time.time()
    target_names = [r['full_name'].split('/')[-1] for r in REPOS]
    
    while time.time() - start < timeout:
        try:
            r = requests.get(API_URL, timeout=5)
            if r.status_code == 200:
                repos = r.json()
                indexed_names = {res['name']: res.get('stats', {}).get('nodes', 0) for res in repos}
                
                all_done = True
                print(f"[{time.strftime('%H:%M:%S')}] 进度检查:")
                for name in target_names:
                    nodes = indexed_names.get(name, 0)
                    status = "✅ 完成" if nodes > 0 else "⏳ 进行中"
                    print(f"  - {name}: {nodes} 节点 {status}")
                    if nodes == 0:
                        all_done = False
                
                if all_done:
                    print("🎉 所有项目索引成功完成！")
                    return True
            else:
                print(f"API 返回异常: {r.status_code}")
        except Exception as e:
            print(f"轮询出错: {e}")
        
        time.sleep(30)
    
    print("❌ 监控超时，部分项目可能仍在索引或已失败。")
    return False

if __name__ == "__main__":
    if not wait_for_ready("http://localhost:1349/status", "API", 60):
        sys.exit(1)
    if not wait_for_ready("http://localhost:1347/health", "Webhook", 30):
        # 兼容旧版本可能没有 /health 的情况，尝试直接触发
        pass
    
    trigger_all()
    if monitor_indexing():
        sys.exit(0)
    else:
        sys.exit(1)
