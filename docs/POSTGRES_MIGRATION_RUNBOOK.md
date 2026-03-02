# PostgreSQL 停机迁移 Runbook（v1）

## 1. 前置条件

- 目标版本代码已部署，且包含 Alembic 与迁移脚本。
- PostgreSQL 已创建数据库与账号。
- 维护窗口安排在非交易时段（建议 15:30 后）。

## 2. 环境变量

```bash
export SOURCE_DATABASE_URL="sqlite:////path/to/mypositions.db"
export TARGET_DATABASE_URL="postgresql://user:password@host:5432/mypositions"
export DATABASE_URL="$TARGET_DATABASE_URL"
export DISABLE_BACKGROUND_WORKERS=true
```

## 3. 停机迁移步骤

1) 进入维护模式（前后端停写）  
2) 备份 SQLite：
```bash
cp /path/to/mypositions.db /path/to/mypositions.db.bak.$(date +%Y%m%d%H%M%S)
```
3) 安装依赖并执行 Alembic：
```bash
cd server
pip install -r requirements.txt
alembic -c alembic.ini upgrade head
```
4) 执行数据迁移：
```bash
cd /path/to/repo
python3 scripts/migrate_sqlite_to_postgres.py \
  --source "$SOURCE_DATABASE_URL" \
  --target "$TARGET_DATABASE_URL" \
  --truncate-target
```
5) 执行一致性校验：
```bash
python3 scripts/verify_migration.py \
  --source "$SOURCE_DATABASE_URL" \
  --target "$TARGET_DATABASE_URL"
```
6) 启动服务并做 smoke：登录、持仓列表、新闻 feed、admin 页面。  
7) 恢复流量。

## 4. 回滚策略

触发条件：关键表校验失败、核心 API 5xx、任务队列持续失败。  
回滚动作：

1) 停服务，切回 `DATABASE_URL` 指向 SQLite 备份文件。  
2) 恢复旧版本应用并启动。  
3) 验证登录、持仓与交易写入可用后恢复流量。
