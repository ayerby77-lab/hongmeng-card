import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { Card, validateCard } from '../model/Card';

// A complete snapshot is flushed to a temporary file before atomic replacement.
// A failed write leaves both the saved file and the displayed list unchanged.
export class CardStore {
  private path: string;

  constructor(filesDir: string) {
    this.path = filesDir + '/cards.json';
  }

  load(): Card[] {
    if (!fs.accessSync(this.path)) {
      return [];
    }
    const cards = JSON.parse(fs.readTextSync(this.path)) as Card[];
    if (!Array.isArray(cards)) {
      throw new Error('名片数据格式错误');
    }
    const ids: string[] = [];
    for (const card of cards) {
      if (!card || typeof card.id !== 'string' || card.id.length === 0 ||
        typeof card.name !== 'string' || typeof card.company !== 'string' ||
        typeof card.title !== 'string' || typeof card.phone !== 'string' ||
        typeof card.email !== 'string' || typeof card.group !== 'string' ||
        typeof card.notes !== 'string' || typeof card.favorite !== 'boolean' ||
        typeof card.createdAt !== 'number' || typeof card.updatedAt !== 'number' ||
        !Number.isFinite(card.createdAt) || !Number.isFinite(card.updatedAt) ||
        ids.indexOf(card.id) >= 0 || validateCard(card).length > 0) {
        throw new Error('名片数据损坏，请保留原文件后检查');
      }
      ids.push(card.id);
    }
    return cards;
  }

  save(cards: Card[]): void {
    const temporary = this.path + '.tmp';
    const file = fs.openSync(temporary, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      const bytes = new util.TextEncoder().encodeInto(JSON.stringify(cards));
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(file.fd, bytes.slice(offset).buffer);
        if (written <= 0) {
          throw new Error('写入本地文件失败');
        }
        offset += written;
      }
      fs.fsyncSync(file.fd);
    } finally {
      fs.closeSync(file);
    }
    fs.renameSync(temporary, this.path);
  }
}
