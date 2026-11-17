// 引用原文页（Agent E）。
//
// 数据来源：真实 RDB 课程资料库（KnowledgeService）。
//   参数（统一走 router.pushUrl 的 params，禁止写 URL 查询串）：
//     documentId       必填；缺失 → 空状态，不崩溃
//     documentRevision 引用产生时的版本；缺省则取库中当前版本
//     segmentId        可选；有值时 → resolveCitation 判定过期 → 高亮该片段并展示上下文
//
// 处理的失效场景：
//   - 资料已删除      → 红色提示 + 空状态
//   - 资料已更新      → 黄色提示（引用版本 vs 当前版本）；片段仍在则展示其原文，并附当前版本全文
//   - 引用片段不存在  → 红色提示 + 当前版本全文
//   高亮基于 resolveCitation 返回的片段（而非仅当前版本片段列表），
//   因此「过期但片段仍存在」也能正确高亮。

import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { CourseDocument, KnowledgeSegment, CitationResolveResult } from '../model/Knowledge';
import { KnowledgeService } from '../service/KnowledgeService';

/** 上下文展示时片段前后各扩展的字符数。 */
const CONTEXT_EXTEND: number = 60;

@Entry
@Component
struct SourceDetail {
  @State private document: CourseDocument | null = null;
  @State private segments: KnowledgeSegment[] = [];
  @State private loading: boolean = true;
  @State private paramMissing: boolean = false;
  @State private errorMsg: string = '';

  /** 失效/过期提示：bannerLevel = '' | 'warn' | 'error'。 */
  @State private bannerText: string = '';
  @State private bannerLevel: string = '';

  /** resolveCitation 解析出的引用片段（可能是旧版本片段）。 */
  @State private citedSegment: KnowledgeSegment | null = null;
  @State private revisionCurrent: boolean = true;

  /** 高亮上下文三段：前文 / 片段 / 后文。 */
  @State private ctxBefore: string = '';
  @State private ctxHighlight: string = '';
  @State private ctxAfter: string = '';

  @State private showSegmentList: boolean = false;

  private service: KnowledgeService | null = null;

  aboutToAppear(): void {
    this.service = KnowledgeService.getInstance(getContext(this) as common.UIAbilityContext);
    const params = router.getParams() as Record<string, Object> | undefined;
    const documentId = params?.['documentId'] as string;
    const documentRevision = params?.['documentRevision'] as number;
    const segmentId = params?.['segmentId'] as string | undefined;

    // 缺 documentId → 空状态提示，不崩溃。
    if (!documentId || documentId.length === 0) {
      this.paramMissing = true;
      this.loading = false;
      return;
    }
    void this.loadData(documentId, documentRevision, segmentId);
  }

  private async loadData(documentId: string, documentRevision: number, segmentId?: string): Promise<void> {
    this.loading = true;
    this.errorMsg = '';
    try {
      const doc: CourseDocument | null = await this.service!.getDocument(documentId);
      if (doc === null) {
        this.errorMsg = '该资料不存在或已被删除，无法查看原文。';
        this.loading = false;
        return;
      }
      this.document = doc;
      // 当前版本片段（用于片段列表视图与片段数展示）。
      this.segments = await this.service!.getSegments(documentId);

      // 有 segmentId 才做引用解析（过期判定 + 高亮）。
      if (segmentId !== undefined && segmentId.length > 0) {
        const citedRevision: number =
          (documentRevision !== undefined && documentRevision > 0) ? documentRevision : doc.revision;
        const res: CitationResolveResult =
          await this.service!.resolveCitation(documentId, citedRevision, segmentId);
        this.applyResolve(res, doc, citedRevision);
      }
    } catch (e) {
      this.errorMsg = '加载失败，请返回重试。';
    } finally {
      this.loading = false;
    }
  }

  /** 根据解析结果装配提示与高亮上下文。 */
  private applyResolve(res: CitationResolveResult, doc: CourseDocument, citedRevision: number): void {
    this.revisionCurrent = res.revisionCurrent;

    if (res.found && res.segment !== undefined) {
      const seg: KnowledgeSegment = res.segment;
      this.citedSegment = seg;
      if (res.revisionCurrent) {
        this.buildContext(doc, seg);
      } else {
        // 片段来自旧版本：不再按当前原文偏移切分，直接展示库中保存的片段原文。
        this.ctxBefore = '';
        this.ctxHighlight = seg.content;
        this.ctxAfter = '';
      }
    } else {
      this.citedSegment = null;
      this.ctxBefore = '';
      this.ctxHighlight = '';
      this.ctxAfter = '';
    }

    if (!res.revisionCurrent) {
      this.bannerLevel = 'warn';
      this.bannerText = (res.staleReason !== undefined && res.staleReason.length > 0)
        ? res.staleReason
        : ('该资料已更新（当前版本 v' + doc.revision + '，引用版本 v' + citedRevision + '），引用内容可能已变更。');
    } else if (!res.found) {
      this.bannerLevel = 'error';
      this.bannerText = (res.staleReason !== undefined && res.staleReason.length > 0)
        ? res.staleReason : '引用片段不存在。';
    } else {
      this.bannerLevel = '';
      this.bannerText = '';
    }
  }

  /** 按片段偏移把当前原文切成「前文 / 片段 / 后文」三段，供高亮展示。 */
  private buildContext(doc: CourseDocument, seg: KnowledgeSegment): void {
    const content: string = doc.content;
    const s: number = seg.startOffset;
    const e: number = seg.endOffset;
    if (s < 0 || e > content.length || s >= e) {
      this.fallbackToSegment(seg);
      return;
    }
    const actual: string = content.substring(s, e);
    if (actual !== seg.content) {
      // 偏移与当前原文不一致：退化为直接展示片段文本，避免切出错误上下文。
      this.fallbackToSegment(seg);
      return;
    }
    const cs: number = Math.max(0, s - CONTEXT_EXTEND);
    const ce: number = Math.min(content.length, e + CONTEXT_EXTEND);
    this.ctxBefore = content.substring(cs, s);
    this.ctxHighlight = actual;
    this.ctxAfter = content.substring(e, ce);
  }

  private fallbackToSegment(seg: KnowledgeSegment): void {
    this.ctxBefore = '';
    this.ctxHighlight = seg.content;
    this.ctxAfter = '';
  }

  private isCited(seg: KnowledgeSegment): boolean {
    const cited: KnowledgeSegment | null = this.citedSegment;
    return cited !== null && cited.id === seg.id;
  }

  build() {
    Column() {
      Row() {
        Button('返回').type(ButtonType.Normal).height(32)
          .onClick(() => router.back())
        Blank()
        Text('引用原文').fontSize(18).fontWeight(FontWeight.Bold)
        Blank()
        if (this.document !== null) {
          Button(this.showSegmentList ? '原文' : '片段').type(ButtonType.Normal).height(32)
            .onClick(() => { this.showSegmentList = !this.showSegmentList; })
        }
      }.width('100%').padding(12)

      if (this.loading) {
        Text('加载中…').fontSize(14).fontColor('#526170').margin({ top: 20 })
      } else if (this.paramMissing) {
        this.EmptyState('缺少资料参数', '未收到 documentId，无法显示引用原文。请从问答回答中的引用条目进入。')
      } else if (this.errorMsg.length > 0) {
        this.EmptyState('无法查看原文', this.errorMsg)
      } else if (this.document !== null) {
        Scroll() {
          Column({ space: 12 }) {
            // 失效 / 过期提示
            if (this.bannerText.length > 0) {
              Column({ space: 4 }) {
                Text(this.bannerLevel === 'warn' ? '⚠ 引用版本提示' : '⚠ 引用失效')
                  .fontSize(14).fontWeight(FontWeight.Bold)
                  .fontColor(this.bannerLevel === 'warn' ? '#B45309' : '#B42318')
                Text(this.bannerText).fontSize(13).lineHeight(20)
                  .fontColor(this.bannerLevel === 'warn' ? '#92400E' : '#7F1D1D')
                  .width('100%')
              }
              .width('100%').padding(12)
              .backgroundColor(this.bannerLevel === 'warn' ? '#FEF3C7' : '#FEE2E2')
              .borderRadius(8)
            }

            // 资料信息
            Column({ space: 4 }) {
              Text(this.document.title).fontSize(20).fontWeight(FontWeight.Bold).width('100%')
              Text('来源：' + this.document.source).fontSize(13).fontColor('#526170').width('100%')
              Text('当前版本：v' + this.document.revision + ' · 片段数：' + this.segments.length)
                .fontSize(12).fontColor('#7A8696').width('100%')
            }.width('100%').padding({ left: 16, right: 16 })

            if (this.showSegmentList) {
              this.SegmentList()
            } else {
              this.OriginalView()
            }
          }.width('100%').padding({ left: 16, right: 16, bottom: 24 })
        }.width('100%').layoutWeight(1)
      }
    }.width('100%').height('100%').backgroundColor('#F5F7FA')
  }

  @Builder
  EmptyState(title: string, detail: string) {
    Column({ space: 8 }) {
      Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#B42318')
      Text(detail).fontSize(13).fontColor('#526170').textAlign(TextAlign.Center)
    }.width('100%').padding({ top: 60, left: 24, right: 24 })
  }

  @Builder
  SegmentList() {
    Column({ space: 10 }) {
      Text('当前版本片段列表（' + this.segments.length + '）')
        .fontSize(12).fontColor('#7A8696').width('100%')
      ForEach(this.segments, (seg: KnowledgeSegment) => {
        Column({ space: 4 }) {
          Text('片段 #' + (seg.seqIndex + 1) + '  [' + seg.startOffset + '-' + seg.endOffset + ']  v'
            + seg.documentRevision + (this.isCited(seg) ? '  ← 引用片段' : ''))
            .fontSize(12)
            .fontColor(this.isCited(seg) ? '#B45309' : '#1570EF')
            .fontWeight(FontWeight.Medium)
            .width('100%')
          Text(seg.content).fontSize(14).lineHeight(22).width('100%')
        }
        .width('100%').padding(8)
        .backgroundColor(this.isCited(seg) ? '#FEF3C7' : '#FFFFFF')
        .borderRadius(8)
      }, (seg: KnowledgeSegment) => seg.id)
    }.width('100%')
  }

  @Builder
  OriginalView() {
    Column({ space: 12 }) {
      if (this.ctxHighlight.length > 0) {
        Column({ space: 4 }) {
          Text('▲ 引用片段'
            + (this.citedSegment !== null ? ' #' + (this.citedSegment.seqIndex + 1)
              + '（v' + this.citedSegment.documentRevision + '）' : '')
            + (this.revisionCurrent ? '' : ' · 来自引用版本，非当前版本'))
            .fontSize(12)
            .fontColor(this.revisionCurrent ? '#B45309' : '#B42318')
            .fontWeight(FontWeight.Medium)
            .width('100%')
          Text(this.ctxHighlight)
            .fontSize(15).lineHeight(26).width('100%')
            .padding(10).backgroundColor('#FEF3C7').borderRadius(6)
        }.width('100%')
      }

      if (this.ctxBefore.length > 0 || this.ctxAfter.length > 0) {
        Text('原文上下文')
          .fontSize(12).fontColor('#7A8696').width('100%')
        Column({ space: 0 }) {
          if (this.ctxBefore.length > 0) {
            Text('…' + this.ctxBefore).fontSize(15).lineHeight(26)
              .fontColor('#3F4A57').width('100%')
          }
          Text(this.ctxHighlight).fontSize(15).lineHeight(26).fontWeight(FontWeight.Medium)
            .fontColor('#111827').width('100%')
            .padding({ top: 4, bottom: 4 })
            .backgroundColor('#FEF3C7').borderRadius(4)
          if (this.ctxAfter.length > 0) {
            Text(this.ctxAfter + '…').fontSize(15).lineHeight(26)
              .fontColor('#3F4A57').width('100%')
          }
        }
        .width('100%').padding(12)
        .backgroundColor('#FFFFFF').borderRadius(8)
        .borderWidth(1).borderColor('#E6EBF2')
      }

      // 引用来自旧版本时，附当前版本全文，体现「修改后内容同步变化」。
      if (!this.revisionCurrent && this.document !== null) {
        Column({ space: 6 }) {
          Text('当前版本原文（v' + this.document.revision + '）')
            .fontSize(12).fontColor('#7A8696').width('100%')
          Text(this.document.content).fontSize(15).lineHeight(26)
            .fontColor('#1F2937').width('100%')
        }
        .width('100%').padding(12)
        .backgroundColor('#FFFFFF').borderRadius(8)
        .borderWidth(1).borderColor('#E6EBF2')
      }

      // 无引用片段（仅从资料管理进入）→ 展示完整原文。
      if (this.ctxHighlight.length === 0 && this.citedSegment === null && this.document !== null) {
        Column({ space: 6 }) {
          Text('原文正文')
            .fontSize(12).fontColor('#7A8696').width('100%')
          Text(this.document.content).fontSize(15).lineHeight(26)
            .fontColor('#1F2937').width('100%')
        }
        .width('100%').padding(12)
        .backgroundColor('#FFFFFF').borderRadius(8)
        .borderWidth(1).borderColor('#E6EBF2')
      }
    }.width('100%')
  }
}
