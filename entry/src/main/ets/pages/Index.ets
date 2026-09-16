import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { Card, emptyCard, validateCard, filterCards, toVCard } from '../model/Card';
import { CardStore } from '../store/CardStore';

@Entry
@Component
struct Index {
  @State private cards: Card[] = [];
  @State private query: string = '';
  @State private group: string = '全部';
  @State private favoritesOnly: boolean = false;
  @State private screen: string = 'list';
  @State private selected: Card = emptyCard();
  @State private draft: Card = emptyCard();
  @State private error: string = '';
  @State private ready: boolean = false;
  @State private busy: boolean = false;
  private store?: CardStore;
  private groups: string[] = ['全部', '同学', '同事', '朋友', '其他'];
  private green: string = '#214E45';
  private ink: string = '#20332E';
  private muted: string = '#707D76';

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.store = new CardStore(context.filesDir);
      this.cards = this.store.load();
      this.ready = true;
      this.error = '';
    } catch (e) {
      this.ready = false;
      this.error = '本地数据读取失败，原文件已保留。请重试或检查应用存储。';
    }
  }

  private copyCard(card: Card): Card {
    return JSON.parse(JSON.stringify(card)) as Card;
  }

  private persist(next: Card[]): boolean {
    if (!this.ready || !this.store || this.busy) {
      return false;
    }
    this.busy = true;
    try {
      this.store.save(next);
      this.cards = next;
      this.error = '';
      return true;
    } catch (e) {
      this.error = '保存失败，请检查存储空间后重试。';
      return false;
    } finally {
      this.busy = false;
    }
  }

  private edit(card?: Card): void {
    this.draft = card ? this.copyCard(card) : emptyCard();
    this.error = '';
    this.screen = 'edit';
  }

  private save(): void {
    this.draft.name = this.draft.name.trim();
    this.draft.phone = this.draft.phone.trim();
    this.draft.email = this.draft.email.trim();
    this.draft.company = this.draft.company.trim();
    this.draft.title = this.draft.title.trim();
    this.error = validateCard(this.draft);
    if (this.error) {
      this.getUIContext().getPromptAction().showToast({ message: this.error });
      return;
    }
    const card = this.copyCard(this.draft);
    card.updatedAt = Date.now();
    if (!card.id) {
      try {
        card.id = util.generateRandomUUID(true);
      } catch (e) {
        this.error = '创建名片编号失败，请重试。';
        return;
      }
      card.createdAt = card.updatedAt;
    }
    const next = this.cards.filter((item: Card) => item.id !== card.id);
    next.unshift(card);
    if (this.persist(next)) {
      this.selected = card;
      this.screen = 'detail';
      this.getUIContext().getPromptAction().showToast({ message: '名片已保存到本机' });
    }
  }

  private favorite(card: Card): void {
    const updated = this.copyCard(card);
    updated.favorite = !updated.favorite;
    updated.updatedAt = Date.now();
    const next = this.cards.map((item: Card) => item.id === updated.id ? updated : item);
    if (this.persist(next)) {
      this.selected = updated;
    }
  }

  private remove(): void {
    this.getUIContext().getPromptAction().showDialog({
      title: '删除名片', message: '确定删除“' + this.selected.name + '”的名片？此操作无法撤销。',
      buttons: [{ text: '取消', color: this.muted }, { text: '删除', color: '#A83B31' }]
    }).then((result) => {
      if (result.index === 1 && this.persist(this.cards.filter((item: Card) => item.id !== this.selected.id))) {
        this.screen = 'list';
      }
    }).catch(() => {});
  }

  private async copy(text: string): Promise<void> {
    try {
      await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text));
      this.getUIContext().getPromptAction().showToast({ message: '已复制' });
    } catch (e) {
      this.error = '复制失败，请重试。';
    }
  }

  private back(): void {
    if (this.screen === 'edit') {
      this.getUIContext().getPromptAction().showDialog({
        title: '离开编辑', message: '离开将放弃当前未保存的修改。',
        buttons: [{ text: '继续编辑', color: this.green }, { text: '放弃修改', color: this.muted }]
      }).then((result) => {
        if (result.index === 1) {
          this.error = '';
          this.screen = this.draft.id ? 'detail' : 'list';
        }
      }).catch(() => {});
    } else {
      this.error = '';
      this.screen = 'list';
    }
  }

  onBackPress(): boolean {
    if (this.screen !== 'list') {
      this.back();
      return true;
    }
    return false;
  }

  @Builder
  private Header(title: string, subtitle: string) {
    Row() {
      Column({ space: 6 }) {
        Text(title).fontSize(30).fontWeight(FontWeight.Bold).fontColor(this.ink)
        Text(subtitle).fontSize(13).fontColor(this.muted)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (this.screen === 'list') {
        Button('+ 新建').backgroundColor(this.green).fontColor('#FFFFFF')
          .enabled(this.ready && !this.busy).onClick(() => this.edit())
      } else {
        Button('返回').backgroundColor('#E6EAE3').fontColor(this.green).onClick(() => this.back())
      }
    }.width('100%').padding({ top: 20, bottom: 20 })
  }

  @Builder
  private CardFace(card: Card) {
    Column({ space: 16 }) {
      Row() {
        Text(card.name.substring(0, 1)).fontSize(27).fontWeight(FontWeight.Bold)
          .fontColor(this.green).backgroundColor('#E6D7B5').width(56).height(56)
          .textAlign(TextAlign.Center).borderRadius(18)
        Column({ space: 5 }) {
          Text(card.name).fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
          Text(card.title || '暂未填写职位').fontSize(13).fontColor('#D3E2DA')
        }.margin({ left: 14 }).alignItems(HorizontalAlign.Start).layoutWeight(1)
        Text(card.favorite ? '★' : '◇').fontSize(24).fontColor('#E6D7B5')
      }.width('100%')
      Text(card.company || '个人名片').fontSize(16).fontColor('#F3F5ED').width('100%')
      Row() {
        Text(card.group || '其他').fontSize(12).fontColor('#E6D7B5')
        Blank()
        Text('CARD FOLIO / 名片夹').fontSize(10).fontColor('#AFC8BB')
      }.width('100%')
    }.padding(24).width('100%').borderRadius(22).backgroundColor(this.green)
  }

  @Builder
  private ListPage() {
    this.Header('名片夹', '把每一次相遇，好好收藏。')
    Row({ space: 24 }) {
      Column({ space: 4 }) {
        Text(this.cards.length.toString()).fontSize(28).fontWeight(FontWeight.Bold).fontColor(this.green)
        Text('本机名片').fontSize(12).fontColor(this.muted)
      }.alignItems(HorizontalAlign.Start)
      Column({ space: 4 }) {
        Text(this.cards.filter((card: Card) => card.favorite).length.toString())
          .fontSize(28).fontWeight(FontWeight.Bold).fontColor(this.green)
        Text('已收藏').fontSize(12).fontColor(this.muted)
      }.alignItems(HorizontalAlign.Start)
      Blank()
      Text('离线可用\n本地保存').fontSize(12).fontColor(this.muted).lineHeight(20)
    }.width('100%').padding(20).backgroundColor('#E8ECE3').borderRadius(18).margin({ bottom: 18 })
    Search({ value: this.query, placeholder: '搜索姓名、公司、电话或邮箱' })
      .backgroundColor('#FFFFFF').height(48).onChange((value: string) => this.query = value)
    Scroll() {
      Row({ space: 8 }) {
        ForEach(this.groups, (value: string) => {
          Button(value).fontSize(13).height(36)
            .backgroundColor(this.group === value ? this.green : '#E7EBE4')
            .fontColor(this.group === value ? '#FFFFFF' : this.green)
            .onClick(() => this.group = value)
        })
      }
    }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%').margin({ top: 14, bottom: 14 })
    Row() {
      Text('名片列表').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.ink)
      Blank()
      Button(this.favoritesOnly ? '★ 仅看收藏' : '☆ 仅看收藏').fontSize(12)
        .backgroundColor(Color.Transparent).fontColor(this.green)
        .onClick(() => this.favoritesOnly = !this.favoritesOnly)
    }.width('100%').margin({ bottom: 10 })
    if (filterCards(this.cards, this.query, this.group, this.favoritesOnly).length === 0) {
      Column({ space: 12 }) {
        Text(this.cards.length === 0 ? '你的第一张名片，从这里开始' : '没有找到匹配的名片')
          .fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.ink)
        Text(this.cards.length === 0 ? '点击右上角“新建”，保存一位联系人。' : '试试其他关键词，或切换分组与收藏筛选。')
          .fontSize(13).fontColor(this.muted).textAlign(TextAlign.Center)
      }.width('100%').padding({ top: 50, bottom: 50 })
    } else {
      ForEach(filterCards(this.cards, this.query, this.group, this.favoritesOnly), (card: Card) => {
        Row({ space: 14 }) {
          Text(card.name.substring(0, 1)).fontSize(21).fontWeight(FontWeight.Bold)
            .fontColor(this.green).width(48).height(48).textAlign(TextAlign.Center)
            .backgroundColor('#E8ECE3').borderRadius(15)
          Column({ space: 5 }) {
            Text(card.name).fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.ink)
            Text([card.company, card.title].filter((value: string) => value.length > 0).join(' · ') || '个人名片')
              .fontSize(12).fontColor(this.muted).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(card.phone || card.email).fontSize(12).fontColor(this.muted).maxLines(1)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Text(card.favorite ? '★' : '›').fontSize(22).fontColor(card.favorite ? '#AF8239' : '#9AABA1')
        }.padding(18).width('100%').backgroundColor('#FFFFFF').borderRadius(18).margin({ bottom: 10 })
          .onClick(() => { this.selected = this.copyCard(card); this.error = ''; this.screen = 'detail'; })
      }, (card: Card) => card.id)
    }
  }

  @Builder
  private Info(label: string, value: string) {
    Column({ space: 8 }) {
      Text(label).fontSize(12).fontColor(this.muted)
      Text(value || '未填写').fontSize(16).fontColor(this.ink).copyOption(CopyOptions.LocalDevice)
    }.alignItems(HorizontalAlign.Start).width('100%').padding(16)
  }

  @Builder
  private DetailPage() {
    this.Header('名片详情', '联系信息，随时在手边。')
    this.CardFace(this.selected)
    Row({ space: 10 }) {
      Button(this.selected.favorite ? '★ 已收藏' : '☆ 收藏').layoutWeight(1)
        .fontColor(this.green).backgroundColor('#E7EBE4').onClick(() => this.favorite(this.selected))
      Button('编辑名片').layoutWeight(1).backgroundColor(this.green).onClick(() => this.edit(this.selected))
    }.width('100%').margin({ top: 18, bottom: 18 })
    Column() {
      this.Info('电话', this.selected.phone)
      Divider().color('#EFF1EC')
      this.Info('邮箱', this.selected.email)
      Divider().color('#EFF1EC')
      this.Info('分组', this.selected.group)
      Divider().color('#EFF1EC')
      this.Info('备注', this.selected.notes)
    }.width('100%').backgroundColor('#FFFFFF').borderRadius(18)
    Button('复制名片 · vCard').width('100%').height(46).backgroundColor('#E7EBE4')
      .fontColor(this.green).margin({ top: 18 }).onClick(() => this.copy(toVCard(this.selected)))
    Text('vCard 文本可粘贴保存为 .vcf 文件，用于交换联系人。')
      .fontSize(11).fontColor(this.muted).margin({ top: 8 })
    Button('删除名片').fontColor('#A83B31').backgroundColor(Color.Transparent)
      .margin({ top: 16 }).onClick(() => this.remove())
  }

  @Builder
  private Label(text: string) {
    Text(text).fontSize(13).fontColor(this.muted).width('100%').margin({ top: 16, bottom: 8 })
  }

  @Builder
  private EditPage() {
    this.Header(this.draft.id ? '编辑名片' : '新建名片', '姓名必填，电话与邮箱至少填写一项。')
    Column() {
      this.Label('姓名 *')
      TextInput({ text: this.draft.name, placeholder: '联系人姓名' }).maxLength(50)
        .backgroundColor('#FFFFFF').onChange((value: string) => this.draft.name = value)
      this.Label('公司 / 学校')
      TextInput({ text: this.draft.company, placeholder: '所在公司或学校' }).maxLength(100)
        .backgroundColor('#FFFFFF').onChange((value: string) => this.draft.company = value)
      this.Label('职位 / 专业')
      TextInput({ text: this.draft.title, placeholder: '职位或专业' }).maxLength(100)
        .backgroundColor('#FFFFFF').onChange((value: string) => this.draft.title = value)
      this.Label('电话')
      TextInput({ text: this.draft.phone, placeholder: '手机或固定电话' }).type(InputType.PhoneNumber).maxLength(30)
        .backgroundColor('#FFFFFF').onChange((value: string) => this.draft.phone = value)
      this.Label('邮箱')
      TextInput({ text: this.draft.email, placeholder: 'name@example.com' }).type(InputType.Email).maxLength(254)
        .backgroundColor('#FFFFFF').onChange((value: string) => this.draft.email = value)
      this.Label('分组')
      Row({ space: 8 }) {
        ForEach(this.groups.slice(1), (value: string) => {
          Button(value).fontSize(13).layoutWeight(1)
            .backgroundColor(this.draft.group === value ? this.green : '#E7EBE4')
            .fontColor(this.draft.group === value ? '#FFFFFF' : this.green)
            .onClick(() => { const next = this.copyCard(this.draft); next.group = value; this.draft = next; })
        })
      }.width('100%')
      this.Label('备注')
      TextArea({ text: this.draft.notes, placeholder: '记录相识的场景、联系偏好……' }).height(110).maxLength(1000)
        .backgroundColor('#FFFFFF').onChange((value: string) => this.draft.notes = value)
      Button('保存名片').width('100%').height(48).backgroundColor(this.green)
        .margin({ top: 24, bottom: 12 }).enabled(this.ready && !this.busy).onClick(() => this.save())
    }.width('100%')
  }

  build() {
    Scroll() {
      Column() {
        if (this.error) {
          Text(this.error).fontSize(14).fontColor('#A83B31').padding(14)
            .backgroundColor('#F8E7E1').borderRadius(12).width('100%').margin({ top: 12 })
        }
        if (!this.ready) {
          this.Header('名片夹', '正在准备本地存储')
          Button('重新读取').backgroundColor(this.green).onClick(() => this.load())
        } else if (this.screen === 'list') {
          this.ListPage()
        } else if (this.screen === 'detail') {
          this.DetailPage()
        } else {
          this.EditPage()
        }
      }.width('100%').constraintSize({ maxWidth: 640 }).padding({ left: 22, right: 22, bottom: 30 })
    }.width('100%').height('100%').backgroundColor('#F5F2EB').scrollBar(BarState.Off)
  }
}
