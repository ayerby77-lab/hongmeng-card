"""记录上传与查询结构。

字段按 docs/api-plan.md「记录上传规划」完整定义，不依赖客户端本地
RecordSaveInput 的字段范围（后者缺 requestId / imageId / timing 子项等，
已在 phase-3-agent-4-report.md 中列为客户端协调项）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelRef(_StrictModel):
    modelId: str = Field(min_length=1, max_length=64)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class InferenceOptions(_StrictModel):
    confidenceThreshold: float = Field(ge=0.0, le=1.0)
    iouThreshold: float = Field(ge=0.0, le=1.0)
    maxDetections: int = Field(ge=1, le=1000)
    executionMode: Literal["sync", "taskpool"]


class InferenceTiming(_StrictModel):
    preprocessMs: float = Field(ge=0.0)
    inferenceMs: float = Field(ge=0.0)
    postprocessMs: float = Field(ge=0.0)
    totalMs: float = Field(ge=0.0)
    coldStart: bool
    modelLoadMs: float = Field(default=0.0, ge=0.0)


class DetectionItem(_StrictModel):
    detectionId: str = Field(min_length=1, max_length=96)
    rawIndex: int = Field(ge=0)
    # 原始类别（模型输出）与最终类别（用户编辑后）分别保存，保证可追溯
    rawClassId: int = Field(ge=0)
    rawLabel: str = Field(min_length=1, max_length=64)
    classId: int = Field(ge=0)
    label: str = Field(min_length=1, max_length=64)
    confidence: float = Field(ge=0.0, le=1.0)
    left: float = Field(ge=0.0)
    top: float = Field(ge=0.0)
    right: float = Field(ge=0.0)
    bottom: float = Field(ge=0.0)
    deleted: bool = False
    classCorrected: bool = False
    editedAtMs: int | None = None


class CountItem(_StrictModel):
    classId: int = Field(ge=0)
    label: str = Field(min_length=1, max_length=64)
    count: int = Field(ge=0)


class RecordUploadItem(_StrictModel):
    schemaVersion: int = Field(default=1, ge=1)
    recordId: str = Field(min_length=1, max_length=64)
    requestId: str = Field(min_length=1, max_length=64)
    imageId: str = Field(min_length=1, max_length=64)
    capturedAtMs: int = Field(ge=0)
    recognizedAtMs: int = Field(ge=0)
    savedAtMs: int = Field(ge=0)
    editedAtMs: int | None = None
    imageWidth: int = Field(gt=0)
    imageHeight: int = Field(gt=0)
    isMirrored: bool = False
    imageOrigin: Literal["camera", "gallery"]
    model: ModelRef
    options: InferenceOptions
    timing: InferenceTiming
    rawDetectionCount: int = Field(ge=0)
    edited: bool = False
    detections: list[DetectionItem] = Field(default_factory=list)
    # 仅作校验；服务端按 detections 重算，不信任客户端计数
    counts: list[CountItem] = Field(default_factory=list)


class RecordBatchRequest(_StrictModel):
    schemaVersion: int = Field(default=1, ge=1)
    records: list[RecordUploadItem] = Field(min_length=1, max_length=50)


class RecordUploadResult(BaseModel):
    recordId: str
    status: Literal["created", "duplicate", "conflict", "invalid"]
    serverRevision: str | None = None
    code: str | None = None
    message: str | None = None


class RecordBatchResponse(BaseModel):
    results: list[RecordUploadResult]


class RecordSummary(BaseModel):
    recordId: str
    recognizedAtMs: int
    savedAtMs: int
    imageOrigin: str
    imageWidth: int
    imageHeight: int
    modelId: str
    executionMode: str
    totalMs: float
    rawDetectionCount: int
    edited: bool
    # 按最终类别（deleted=false）重算：count 降序，classId 升序
    counts: list[CountItem]


class RecordPage(BaseModel):
    items: list[RecordSummary]
    page: int
    pageSize: int
    total: int
    hasMore: bool
