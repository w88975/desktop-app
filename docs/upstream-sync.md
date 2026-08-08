# 上游同步指南（craft-agents-oss）

aidp-desktop 基于开源项目 [craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss)（Apache-2.0）二次开发，起始快照为 **v0.11.4**（上游提交 `50ffa143`，2026-08-06）。

我们**不与上游合并**，只把它当作只读参考：上游发布新版本时，人工比对 diff，挑需要的改动手工移植。

## 为什么不能直接 merge / cherry-pick

上游是「一个版本 = 一个压缩提交」——100 个提交对应 78 个 tag，提交信息就是 `v0.11.4`、`v0.11.3`……**不存在独立的 bugfix 提交**，所以没有可以 cherry-pick 的粒度。

同时 aidp-desktop 的 `develop` 与上游历史无共同祖先，`git merge upstream/main` 只会产生大量无意义冲突。**不要执行**。

唯一可行的方式：看上游两个版本之间改了什么，然后手工搬。好消息是单版本改动量通常不大（v0.11.3 → v0.11.4 只有 28 个文件、253 增 112 删）。

## 一次性配置

```bash
git remote add upstream https://github.com/craft-ai-agents/craft-agents-oss.git
git config remote.upstream.tagOpt --no-tags
git config --replace-all remote.upstream.fetch '+refs/heads/*:refs/remotes/upstream/*'
git config --add         remote.upstream.fetch '+refs/tags/*:refs/upstream-tags/*'
git fetch upstream
```

第三、四行是关键：上游的 78 个 tag 会落到独立的 `refs/upstream-tags/` 命名空间，**不会污染本地 `refs/tags/`**。我们自己打 `v1.0.0` 之类的版本号不会和上游冲突，`git push --tags` 也不会把上游 tag 泄漏到内网 GitLab。

首次 fetch 约 114MB，只存在于你本地，不会推到 `origin`。

验证配置是否正确：

```bash
git tag | wc -l                                    # 应为 0（上游 tag 不在这里）
git for-each-ref refs/upstream-tags | wc -l        # 应为 78+
```

## 日常用法

tag 名可直接用 `upstream-tags/vX.Y.Z` 引用，无需写完整 ref 路径。

```bash
# 拉取上游更新
git fetch upstream

# 上游最新版本是什么
git for-each-ref refs/upstream-tags --sort=-v:refname --format='%(refname:short)' | head -5

# 某个版本区间改了什么（先看波及面）
git diff --stat upstream-tags/v0.11.4 upstream-tags/v0.12.0

# 只看我们关心的模块
git diff upstream-tags/v0.11.4 upstream-tags/v0.12.0 -- apps/electron

# 生成补丁再人工挑
git diff upstream-tags/v0.11.4 upstream-tags/v0.12.0 -- packages/core > /tmp/upstream.patch

# 对照我们改过的版本，确认冲突面
git diff upstream-tags/v0.11.4 develop -- apps/electron
```

## 移植改动的建议流程

1. `git diff --stat` 看清波及范围，判断有没有碰到我们重写过的文件
2. 按模块拆开看，逐条判断「要不要」而不是「能不能自动合」
3. 移植后在提交信息里注明上游来源，例如：
   `fix: 移植上游 v0.12.0 的会话超时修复 (upstream 50ffa143..xxxxxxx)`
4. 更新本文件顶部记录的「已对齐到的上游版本」

## License 注意事项

上游为 Apache-2.0，仓库根目录的 `LICENSE`、`NOTICE`、`TRADEMARK.md` 需保留。对外分发时注意商标条款（见 `TRADEMARK.md`）——代码可用，但产品名称/品牌不能直接沿用。
