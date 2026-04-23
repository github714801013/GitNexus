import requests
import time
import sys
import json

import os

# 配置
BASE_URL = "http://localhost:1347/webhook/gitea"
API_URL = "http://localhost:1349/api/repos"

LOCAL_REPOS = "repos.json"
REMOTE_REPOS = "/home/ji99/gitnexus/repos.json"

repos_dict = {}

# 加载远端运行环境现有的项目配置（来自真实 Webhook 更新或历史记录）
if os.path.exists(REMOTE_REPOS):
    try:
        with open(REMOTE_REPOS, "r", encoding="utf-8") as f:
            for r in json.load(f):
                if r.get("full_name"):
                    repos_dict[r["full_name"]] = r
    except Exception as e:
        print(f"读取远程 repos.json 失败: {e}")

# 加载本地部署包带过来的配置，如果存在相同项目，则跳过不覆盖，只追加新项目
if os.path.exists(LOCAL_REPOS):
    try:
        with open(LOCAL_REPOS, "r", encoding="utf-8") as f:
            for r in json.load(f):
                if r.get("full_name") and r["full_name"] not in repos_dict:
                    repos_dict[r["full_name"]] = r
    except Exception as e:
        print(f"读取本地 repos.json 失败: {e}")

REPOS = list(repos_dict.values())

# 将合并后的配置写回远程文件，作为源配置
try:
    with open(REMOTE_REPOS, "w", encoding="utf-8") as f:
        json.dump(REPOS, f, indent=2, ensure_ascii=False)
except Exception as e:
    print(f"同步写入 {REMOTE_REPOS} 失败: {e}")

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
        branch = repo.get("branch", "master")
        payload = {
            "repository": repo,
            "ref": f"refs/heads/{branch}"
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
