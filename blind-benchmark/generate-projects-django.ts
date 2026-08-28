/**
 * Django 合成金标生成器（M2）——镜像 generate-projects-fastapi.ts 方法论
 *
 * 项目规格（风格 × 变体，按适用性组合，共 8 项目）：
 *   D1 FBV：urls.py + views.py（@login_required）
 *   D2 CBV：类视图 + LoginRequiredMixin
 *   D3 DRF：APIView + permission_classes
 * 变体：clean / V1 无保护 mutation 视图 / V2 AllowAny / V2b 空权限类 /
 *       V1V2（FBV 无保护 + DRF AllowAny 混合项目）
 * 金标 = 每项目预期 (rule, handler) 清单（gold.json 随项目落盘）。
 *
 * Usage: npx ts-node blind-benchmark/generate-projects-django.ts
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated-django");

interface Spec {
  id: string;
  files: { [file: string]: string };
  gold: Array<{ rule: string; handler: string | null }>;
}

const FBV_VIEWS = `from django.contrib.auth.decorators import login_required
from django.http import JsonResponse


def home(request):
    return JsonResponse({"ok": True})


def transfer_money(request):
    return JsonResponse({"transferred": True})
`;

const FBV_VIEWS_PROTECTED = FBV_VIEWS.replace(
  "def transfer_money(request):",
  "@login_required\ndef transfer_money(request):"
);

const URLS_FBV = `from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("transfer", views.transfer_money, name="transfer"),
]
`;

const CBV_PROTECTED = `from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.http import JsonResponse


class EditView(LoginRequiredMixin, View):
    def post(self, request):
        return JsonResponse({"edited": True})


class ReadView(View):
    def get(self, request):
        return JsonResponse({"ok": True})
`;

const CBV_OPEN = `from django.views import View
from django.http import JsonResponse


class EditView(View):
    def post(self, request):
        return JsonResponse({"edited": True})


class ReadView(View):
    def get(self, request):
        return JsonResponse({"ok": True})
`;

const URLS_CBV = `from django.urls import path
from . import views

urlpatterns = [
    path("edit", views.EditView.as_view(), name="edit"),
    path("read", views.ReadView.as_view(), name="read"),
]
`;

const DRF_PROTECTED = `from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.response import Response


class SendMoneyAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        return Response({"sent": True})


class PublicListAPIView(APIView):
    permission_classes = ()

    def get(self, request):
        return Response({"items": []})
`;

const DRF_ALLOWANY = DRF_PROTECTED.replace(
  "permission_classes = (IsAuthenticated,)",
  "permission_classes = (AllowAny,)"
).replace(
  "from rest_framework.permissions import IsAuthenticated",
  "from rest_framework.permissions import AllowAny"
);

const DRF_EMPTY = DRF_PROTECTED.replace(
  "permission_classes = (IsAuthenticated,)",
  "permission_classes = []"
);

const URLS_DRF = `from django.urls import path
from . import views

urlpatterns = [
    path("send", views.SendMoneyAPIView.as_view(), name="send"),
    path("list", views.PublicListAPIView.as_view(), name="list"),
]
`;

const SPECS: Spec[] = [
  {
    id: "dj_D1_clean",
    files: { "views.py": FBV_VIEWS_PROTECTED, "urls.py": URLS_FBV },
    gold: [],
  },
  {
    id: "dj_D1_V1",
    files: { "views.py": FBV_VIEWS, "urls.py": URLS_FBV },
    gold: [{ rule: "DJANGO_VIEW_NO_AUTH", handler: "transfer_money" }],
  },
  {
    id: "dj_D2_clean",
    files: { "views.py": CBV_PROTECTED, "urls.py": URLS_CBV },
    gold: [],
  },
  {
    id: "dj_D2_V1",
    files: { "views.py": CBV_OPEN, "urls.py": URLS_CBV },
    gold: [{ rule: "DJANGO_VIEW_NO_AUTH", handler: "EditView" }],
  },
  {
    id: "dj_D3_clean",
    files: { "views.py": DRF_PROTECTED, "urls.py": URLS_DRF },
    gold: [],
  },
  {
    id: "dj_D3_V2",
    files: { "views.py": DRF_ALLOWANY, "urls.py": URLS_DRF },
    gold: [{ rule: "DRF_PERMISSION_BYPASS", handler: "SendMoneyAPIView" }],
  },
  {
    id: "dj_D3_V2b",
    files: { "views.py": DRF_EMPTY, "urls.py": URLS_DRF },
    gold: [{ rule: "DRF_PERMISSION_BYPASS", handler: "SendMoneyAPIView" }],
  },
  {
    id: "dj_D1D3_V1V2",
    files: {
      "views.py": FBV_VIEWS + "\n\n" + DRF_ALLOWANY.replace(
        "from rest_framework.permissions import AllowAny",
        "from rest_framework.permissions import AllowAny"
      ),
      "urls.py": `from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("transfer", views.transfer_money, name="transfer"),
    path("send", views.SendMoneyAPIView.as_view(), name="send"),
]
`,
    },
    gold: [
      { rule: "DJANGO_VIEW_NO_AUTH", handler: "transfer_money" },
      { rule: "DRF_PERMISSION_BYPASS", handler: "SendMoneyAPIView" },
    ],
  },
];

function main() {
  fs.rmSync(GEN_DIR, { recursive: true, force: true });
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const manifest: any[] = [];
  for (const spec of SPECS) {
    const dir = path.join(GEN_DIR, spec.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(spec.files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    manifest.push({ id: spec.id, gold: spec.gold });
  }
  fs.writeFileSync(path.join(GEN_DIR, "gold.json"), JSON.stringify(manifest, null, 2));
  console.log(`生成 ${manifest.length} 项目 → ${GEN_DIR}`);
}

main();
