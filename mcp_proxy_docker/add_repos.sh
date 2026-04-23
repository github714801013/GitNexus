#!/bin/bash
set -e

mkdir -p ~/gitnexus/oa-java ~/gitnexus/group-logistics ~/gitnexus/OA_CSharp

cd ~/gitnexus/oa-java
if [ ! -d "oa-order" ]; then
    echo "正在克隆 oa-order..."
    git clone https://code.9ji.com/oa-java/oa-order.git || echo "克隆 oa-order 失败"
fi

cd ~/gitnexus/group-logistics
if [ ! -d "oa-stock" ]; then
    echo "正在克隆 oa-stock..."
    git clone https://code.9ji.com/group-logistics/oa-stock.git || echo "克隆 oa-stock 失败"
fi

cd ~/gitnexus/OA_CSharp
if [ ! -d "oanew" ]; then
    echo "正在克隆 oanew..."
    git clone https://code.9ji.com/OA_CSharp/oanew.git || echo "克隆 oanew 失败"
fi

echo "--- 触发新项目的增量索引 ---"
for dir in "/projects/oa-java/oa-order" "/projects/group-logistics/oa-stock" "/projects/OA_CSharp/oanew"; do
    echo "正在触发索引: $dir"
    docker exec -d gitnexus-mcp-proxy bash -c "
        git config --global --add safe.directory '*'
        echo '--------------------------------------------------------' > /proc/1/fd/1
        echo '手动触发索引: $dir' > /proc/1/fd/1
        /usr/bin/node /app/gitnexus/dist/gitnexus/src/cli/index.js analyze '$dir' --embeddings --force > /proc/1/fd/1 2>&1
    "
done
