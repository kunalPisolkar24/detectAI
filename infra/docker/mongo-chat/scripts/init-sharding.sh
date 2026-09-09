#!/bin/bash
set -euo pipefail

mongos_host="mongos:27017"
db="chat_db"

echo "[sharded-init] Waiting for mongos at $mongos_host..."
for i in $(seq 1 30); do
  if mongosh --host "$mongos_host" --quiet --eval "db.adminCommand('ping').ok" | grep -q 1; then
    echo "[sharded-init] mongos is up"
    break
  fi
  echo "[sharded-init] mongos not ready, attempt $i"
  sleep 2
done

echo "[sharded-init] Initiating config rs and shards..."
mongosh --host mongo-configsvr:27017 --quiet --eval 'try{rs.initiate({_id:"cfg-rs",configsvr:true,members:[{_id:0,host:"mongo-configsvr:27017"}]})}catch(e){print(e)}'
mongosh --host mongo-shard1:27017 --quiet --eval 'try{rs.initiate({_id:"shard1-rs",members:[{_id:0,host:"mongo-shard1:27017"}]})}catch(e){print(e)}'
mongosh --host mongo-shard2:27017 --quiet --eval 'try{rs.initiate({_id:"shard2-rs",members:[{_id:0,host:"mongo-shard2:27017"}]})}catch(e){print(e)}'

echo "[sharded-init] Waiting for RS primary election..."
sleep 8

for i in $(seq 1 20); do
  if mongosh --host "$mongos_host" --quiet --eval 'sh.addShard("shard1-rs/mongo-shard1:27017")' 2>&1 | grep -q -E "already|added|ok"; then
    echo "[sharded-init] shard1 added"
    break
  fi
  echo "[sharded-init] retry addShard shard1 $i"
  sleep 2
done
for i in $(seq 1 20); do
  if mongosh --host "$mongos_host" --quiet --eval 'sh.addShard("shard2-rs/mongo-shard2:27017")' 2>&1 | grep -q -E "already|added|ok"; then
    echo "[sharded-init] shard2 added"
    break
  fi
  echo "[sharded-init] retry addShard shard2 $i"
  sleep 2
done

echo "[sharded-init] Creating indexes (must precede shardCollection)..."
mongosh --host "$mongos_host" --quiet --eval "
db = db.getSiblingDB('$db');
try{db.chats.createIndex({user_id:1, updated_at:-1},{name:'idx_user_chats_timeline'})}catch(e){print(e)}
try{db.messages.createIndex({chat_id:1, bucket_index:-1},{name:'idx_chat_history_lookup'})}catch(e){print(e)}
try{db.messages.createIndex({chat_id:1,'messages._id':1},{name:'idx_chat_message_id'})}catch(e){print(e)}
try{db.messages.createIndex({chat_id:1,count:1,end_date:1},{name:'idx_bucket_capacity'})}catch(e){print(e)}
print('indexes done')
"

echo "[sharded-init] Enabling sharding on db and collection..."
mongosh --host "$mongos_host" --quiet --eval "
try{sh.enableSharding('$db')}catch(e){print('enableSharding: '+e)}
try{sh.shardCollection('$db.messages',{chat_id:'hashed'})}catch(e){print('shardCollection: '+e)}
print('sharding done')
try{printjson(sh.status())}catch(e){}
"

echo "[sharded-init] Done — chats unsharded, messages sharded on chat_id:hashed"
