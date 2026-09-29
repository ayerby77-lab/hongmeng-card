import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { Message, validateMessages } from '../model/Message';

// A complete snapshot is flushed to a temporary file before atomic replacement.
// A failed write leaves both the saved file and the displayed list unchanged.
export class MessageStore {
  private path: string;

  constructor(filesDir: string) {
    this.path = filesDir + '/messages.json';
  }

  load(): Message[] {
    if (!fs.accessSync(this.path)) {
      return [];
    }
    const cards = JSON.parse(fs.readTextSync(this.path)) as Message[];
    validateMessages(cards);
    return cards;
  }

  save(cards: Message[]): void {
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
