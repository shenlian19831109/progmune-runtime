/**
 * django-detector.test.ts — Django 框架适配器规则回归（纯函数，无文件 I/O）
 *
 * 规则判定与结构提取解耦：扫描器（tools/extract_framework_django.py）只做
 * 结构，本模块消费结构 JSON 做 DJANGO_VIEW_NO_AUTH / DRF_PERMISSION_BYPASS。
 */
import { describe, it, expect } from "vitest";
import { analyzeDjangoStructure } from "./django-detector";
import type { DjangoStructure, DjangoViewInfo } from "./django-detector";

function structure(partial: Partial<DjangoStructure>): DjangoStructure {
  return {
    hasDjango: true,
    routes: [],
    views: {},
    filesScanned: 1,
    ...partial,
  };
}

const fbv = (name: string, extra: Partial<DjangoViewInfo> = {}): DjangoViewInfo => ({
  file: "views.py", kind: "fbv", decorators: [], authDecorators: [],
  apiViewMethods: null, permissionClasses: [],
  ...extra,
});

const cbv = (name: string, extra: Partial<DjangoViewInfo> = {}): DjangoViewInfo => ({
  file: "views.py", kind: "cbv", decorators: [], authDecorators: [],
  apiViewMethods: null, permissionClasses: [], bases: [], methods: [],
  isDrf: false, protectedByMixin: false, openPermission: false,
  ...extra,
});

describe("django-detector", () => {
  it("R1：无保护的 FBV 动词名视图 → DJANGO_VIEW_NO_AUTH", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "transfer", urlname: "", view: "transfer_money", kind: "fbv", file: "urls.py" }],
      views: { transfer_money: fbv("transfer_money") },
    }));
    expect(issues.map((i) => i.rule)).toContain("DJANGO_VIEW_NO_AUTH");
  });

  it("R1 识别 @login_required 保护", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "transfer", urlname: "", view: "transfer_money", kind: "fbv", file: "urls.py" }],
      views: { transfer_money: fbv("transfer_money", { authDecorators: ["login_required"] }) },
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：home/robots/error 等信息页动词门控不报", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [
        { pattern: "", urlname: "", view: "home", kind: "fbv", file: "urls.py" },
        { pattern: "robots.txt", urlname: "", view: "robots", kind: "fbv", file: "urls.py" },
      ],
      views: { home: fbv("home"), robots: fbv("robots") },
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：registration 词干（不含 register 子串的陷阱回归）", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "^users/?$", urlname: "", view: "RegistrationAPIView", kind: "cbv", file: "urls.py" }],
      views: {
        RegistrationAPIView: cbv("RegistrationAPIView", {
          isDrf: true, methods: ["post"],
          permissionClasses: ["AllowAny"], openPermission: true,
        }),
      },
    }));
    expect(issues).toHaveLength(0);
  });

  it("R2：DRF 写方法 + AllowAny → DRF_PERMISSION_BYPASS", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "send", urlname: "", view: "SendMoneyAPIView", kind: "cbv", file: "urls.py" }],
      views: {
        SendMoneyAPIView: cbv("SendMoneyAPIView", {
          isDrf: true, methods: ["post"],
          permissionClasses: ["AllowAny"], openPermission: true,
        }),
      },
    }));
    expect(issues.map((i) => i.rule)).toContain("DRF_PERMISSION_BYPASS");
  });

  it("R2：IsAuthenticated 保护不报；只读视图（list/retrieve）不报", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [
        { pattern: "send", urlname: "", view: "SendMoneyAPIView", kind: "cbv", file: "urls.py" },
        { pattern: "tags", urlname: "", view: "TagListAPIView", kind: "cbv", file: "urls.py" },
      ],
      views: {
        SendMoneyAPIView: cbv("SendMoneyAPIView", {
          isDrf: true, methods: ["post"],
          permissionClasses: ["IsAuthenticated"], openPermission: false,
        }),
        TagListAPIView: cbv("TagListAPIView", {
          isDrf: true, methods: ["list"],
          permissionClasses: ["AllowAny"], openPermission: true,
        }),
      },
    }));
    expect(issues).toHaveLength(0);
  });

  it("非 DRF CBV：写方法 + LoginRequiredMixin → 不报", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "edit", urlname: "", view: "EditView", kind: "cbv", file: "urls.py" }],
      views: {
        EditView: cbv("EditView", {
          isDrf: false, methods: ["post"], protectedByMixin: true,
        }),
      },
    }));
    expect(issues).toHaveLength(0);
  });

  it("@api_view 写方法 + permission_classes 保护 → 不报", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "api", urlname: "", view: "api_transfer", kind: "fbv", file: "urls.py" }],
      views: {
        api_transfer: fbv("api_transfer", {
          apiViewMethods: ["post"], permissionClasses: ["IsAuthenticated"],
        }),
      },
    }));
    expect(issues).toHaveLength(0);
  });

  it("include 与无法解析的引用（admin.site.urls）不报", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [
        { pattern: "^admin/", urlname: "", view: "urls", kind: "fbv", file: "urls.py" },
        { pattern: "^api/", urlname: "", view: null, kind: "include", file: "urls.py" },
      ],
      views: {},
    }));
    expect(issues).toHaveLength(0);
  });

  it("非 Django 结构不产生任何问题", () => {
    const { hasDjango, issues } = analyzeDjangoStructure(
      structure({ hasDjango: false, routes: [] })
    );
    expect(hasDjango).toBe(false);
    expect(issues).toHaveLength(0);
  });
});

describe("django-detector ViewSet 展开回归", () => {
  it("同一 ViewSet 多条展开路由（集合+详情）DRF_PERMISSION_BYPASS 只报一次", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [
        { pattern: "^articles/?$", urlname: "", view: "ArticleViewSet", kind: "cbv", file: "urls.py" },
        { pattern: "^articles/(?P<pk>[^/.]+)/?$", urlname: "", view: "ArticleViewSet", kind: "cbv", file: "urls.py" },
      ],
      views: {
        ArticleViewSet: cbv("ArticleViewSet", {
          isDrf: true, methods: ["create", "list", "retrieve", "update"],
          permissionClasses: ["AllowAny"], openPermission: true,
        }),
      },
    }));
    expect(issues.filter((i) => i.rule === "DRF_PERMISSION_BYPASS")).toHaveLength(1);
  });

  it("受保护 ViewSet（IsAuthenticatedOrReadOnly）不报——写面现在被真正检查", () => {
    const { issues } = analyzeDjangoStructure(structure({
      routes: [{ pattern: "^articles/?$", urlname: "", view: "ArticleViewSet", kind: "cbv", file: "urls.py" }],
      views: {
        ArticleViewSet: cbv("ArticleViewSet", {
          isDrf: true, methods: ["create", "list", "retrieve", "update"],
          permissionClasses: ["IsAuthenticatedOrReadOnly"], openPermission: false,
        }),
      },
    }));
    expect(issues).toHaveLength(0);
  });
});
