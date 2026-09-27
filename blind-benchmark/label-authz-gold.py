#!/usr/bin/env python3
"""把 fp-gold.jsonl 里授权族的 17 条 UNKNOWN 逐条定性并写回。

每条都经人工读源码确认（2026-09-27），判定依据含文件与行号，可复核。
用法：python3 blind-benchmark/label-authz-gold.py [--dry-run]
"""
import json
import sys
from pathlib import Path

GOLD = Path(__file__).resolve().parent / "fp-gold.jsonl"

# (repo, fn, rule) -> (gold, reason)
LABELS = {
    ("docmost", "JwtAuthGuard.handleRequest", "Authorization (Unauthenticated Access)"): (
        "FP",
        "jwt-auth.guard.ts:44-84 Passport JWT 守卫回调，本身即鉴权机制：校验 err/user、"
        "session authType、oauth scope，抛 Unauthorized/ForbiddenException。D 类自指。",
    ),
    ("docmost", "JwtAuthGuard.handleRequest", "Authorization (Unauthenticated Mutation)"): (
        "FP",
        "同上，守卫回调不写业务数据；仅经 setJoinedWorkspacesCookie 写自身 cookie。D 类自指。",
    ),
    ("docmost", "JwtAuthGuard.setJoinedWorkspacesCookie", "Authorization (Unauthenticated Access)"): (
        "FP",
        "jwt-auth.guard.ts:86-113 守卫内部私有辅助，唯一调用点是已鉴权后的 handleRequest:82；"
        "非业务入口，入参 user 来自已鉴权上下文。",
    ),
    ("docmost", "JwtAuthGuard.setJoinedWorkspacesCookie", "Authorization (Unauthenticated Mutation)"): (
        "FP",
        "同上。写的是当前用户自己的 joinedWorkspaces cookie，不构成越权。",
    ),
    ("docmost", "AttachmentController.uploadFile", "Authorization (Ownership Check)"): (
        "FP",
        "attachment.controller.ts:131 await this.pageAccessService.validateCanEdit(page, user) —— "
        "显式属主/编辑权校验，且在真正上传之前。",
    ),
    ("docmost", "AttachmentController.uploadAvatarOrLogo", "Authorization (Ownership Check)"): (
        "FP",
        "attachment.controller.ts:317-325 / 333-338 按 attachmentType 分支做 "
        "ability.cannot(...) → throw ForbiddenException（CASL 能力检查）。",
    ),
    ("docmost", "AttachmentController.removeIcon", "Authorization (Ownership Check)"): (
        "FP",
        "attachment.controller.ts:486-488 / 499-504 spaceAbility.cannot(Manage, Settings) → "
        "throw ForbiddenException；Avatar 分支只删自己的头像（removeUserAvatar(user)）。",
    ),
    ("docmost", "AttachmentController.removeIcon", "Authorization (Resource Ownership)"): (
        "FP",
        "同上，资源属主检查已由 CASL cannot + ForbiddenException 完成。",
    ),
    ("docmost", "CommentController.delete", "Authorization (Ownership Check)"): (
        "FP",
        "comment.controller.ts:164 validateCanComment(page, user, workspace.id)；"
        ":167 isOwner = comment.creatorId === user.id 显式属主判定；"
        ":169-178 非属主时再走 spaceAbility.cannot 兜底。三层校验齐备。",
    ),
    ("docmost", "GroupController.updateGroup", "Authorization (Ownership Check)"): (
        "FP",
        "group.controller.ts:89-94 workspaceAbility.createForUser(user, workspace) 后 "
        "ability.cannot(Manage, Group) → throw ForbiddenException；类上有 @UseGuards(JwtAuthGuard)。",
    ),
    ("docmost", "GroupController.removeGroupMember", "Authorization (Ownership Check)"): (
        "FP",
        "group.controller.ts:147-152 ability.cannot(Manage, Group) → throw ForbiddenException。",
    ),
    ("docmost", "GroupController.removeGroupMember", "Authorization (Resource Ownership)"): (
        "FP",
        "同上；且 workspace.id 由 @AuthWorkspace 注入而非请求体，无跨租户取参。",
    ),
    ("docmost", "GroupController.deleteGroup", "Authorization (Ownership Check)"): (
        "FP",
        "group.controller.ts:168-173 ability.cannot(Manage, Group) → throw ForbiddenException。",
    ),
    ("docmost", "SpaceAbilityFactory.createForUser", "Authorization (Unauthenticated Access)"): (
        "FP",
        "space-ability.factory.ts:20-38 CASL 能力工厂，只构造 ability 对象供下游 can/cannot 判定，"
        "不读不写任何业务数据。D 类自指（§39 未覆盖 CASL 工厂形态）。",
    ),
    ("docmost", "SpaceAbilityFactory.createForUser", "Authorization (Unauthenticated Mutation)"): (
        "FP",
        "同上；无副作用，仅 switch 角色后返回 ability。D 类自指。",
    ),
    ("verdaccio", "StorageViewCommand.deleteEntry", "Authorization (Ownership Check)"): (
        "FP",
        "view.ts:224-227 if (!(await canRemove(auth, user, entry.name))) { 输出拒绝原因; return false; } "
        "—— 调用了权限谓词**且检查了返回值并提前返回**，是教科书式的正确写法。"
        "缺口在于 canRemove 这类谓词名不含 auth/verify/check 词根，未被识别为鉴权函数。",
    ),
    ("verdaccio", "StorageViewCommand.deleteEntry", "Authorization (Resource Ownership)"): (
        "FP",
        "同上，资源删除权限已由 canRemove(auth, user, entry.name) 显式判定。",
    ),
}


def main() -> int:
    dry = "--dry-run" in sys.argv
    rows = [json.loads(l) for l in GOLD.read_text(encoding="utf-8").splitlines() if l.strip()]
    hit = miss = 0
    for r in rows:
        key = (r.get("repo"), r.get("fn"), r.get("rule"))
        if key in LABELS:
            gold, reason = LABELS[key]
            assert r.get("gold") == "UNKNOWN", f"预期 UNKNOWN，实际 {r.get('gold')}: {key}"
            r["gold"] = gold
            r["gold_confidence"] = "verified"
            r["gold_reason"] = reason
            hit += 1
        elif r.get("gold") == "UNKNOWN" and (
            "Authorization" in (r.get("rule") or "") or "Ownership" in (r.get("rule") or "")
        ):
            miss += 1
            print(f"[未覆盖] {key}")
    assert miss == 0, f"还有 {miss} 条授权族 UNKNOWN 未标注"
    if dry:
        print(f"[dry-run] 将更新 {hit} 条")
        return 0
    GOLD.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8"
    )
    print(f"已写回 {hit} 条（全部 FP，verified）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
