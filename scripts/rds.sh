#!/usr/bin/env bash
# Open a local psql session to the gx-server RDS instance.
#
# Tunnels through a running ECS task with SSM port forwarding, so it needs
# no bastion and no public DB access. Requirements:
#   - AWS credentials with ecs/ssm/secretsmanager read access
#   - session-manager-plugin on PATH
#   - psql on PATH
#
# Usage:
#   scripts/rds.sh              # production psql shell
#   scripts/rds.sh staging     # staging psql shell
#   scripts/rds.sh production "select count(*) from review_usage"
set -euo pipefail

env_name="${1:-production}"
sql="${2:-}"
region="${AWS_REGION:-us-east-1}"
cluster="gx-server-$env_name"
local_port="${GX_DB_LOCAL_PORT:-5433}"

command -v session-manager-plugin >/dev/null || {
  echo "session-manager-plugin not found; install it first" >&2
  exit 1
}
command -v psql >/dev/null || {
  echo "psql not found; brew install libpq (or postgresql)" >&2
  exit 1
}

task_arn="$(aws ecs list-tasks --region "$region" --cluster "$cluster" \
  --desired-status RUNNING --query 'taskArns[0]' --output text)"
if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
  echo "no running task in $cluster" >&2
  exit 1
fi
task_id="${task_arn##*/}"

runtime_id="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" \
  --tasks "$task_arn" \
  --query "tasks[0].containers[?name=='gx-server'] | [0].runtimeId" --output text)"
task_def="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" \
  --tasks "$task_arn" --query 'tasks[0].taskDefinitionArn' --output text)"

db_secret_arn="$(aws ecs describe-task-definition --region "$region" \
  --task-definition "$task_def" \
  --query "taskDefinition.containerDefinitions[0].secrets[?name=='PGHOST'] | [0].valueFrom" \
  --output text)"
db_secret_arn="${db_secret_arn%:host::}"

creds="$(aws secretsmanager get-secret-value --region "$region" \
  --secret-id "$db_secret_arn" --query SecretString --output text)"
db_host="$(printf '%s' "$creds" | python3 -c 'import json,sys;print(json.load(sys.stdin)["host"])')"
db_user="$(printf '%s' "$creds" | python3 -c 'import json,sys;print(json.load(sys.stdin)["username"])')"
db_pass="$(printf '%s' "$creds" | python3 -c 'import json,sys;print(json.load(sys.stdin)["password"])')"

echo "tunnel: localhost:$local_port -> $db_host:5432 (via task $task_id)" >&2
aws ssm start-session --region "$region" \
  --target "ecs:${cluster}_${task_id}_${runtime_id}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$db_host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$local_port\"]}" \
  >/dev/null &
tunnel_pid=$!
trap 'kill "$tunnel_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if nc -z 127.0.0.1 "$local_port" 2>/dev/null; then
    break
  fi
  sleep 1
done

conn="postgresql://$db_user:$db_pass@127.0.0.1:$local_port/gx?sslmode=require"
if [[ -n "$sql" ]]; then
  psql "$conn" -c "$sql"
else
  psql "$conn"
fi
