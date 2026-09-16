export interface Card {
  id: string;
  name: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  group: string;
  notes: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export function emptyCard(): Card {
  return {
    id: '', name: '', company: '', title: '', phone: '', email: '',
    group: '其他', notes: '', favorite: false, createdAt: 0, updatedAt: 0
  };
}

export function validateCard(card: Card): string {
  if (card.name.trim().length === 0) {
    return '请输入姓名';
  }
  if (card.name.length > 50) {
    return '姓名最多 50 个字符';
  }
  if (card.company.length > 100 || card.title.length > 100) {
    return '公司和职位各最多 100 个字符';
  }
  if (card.group.length > 30) {
    return '分组最多 30 个字符';
  }
  if (card.notes.length > 1000) {
    return '备注最多 1000 个字符';
  }
  const phone: string = card.phone.trim();
  const email: string = card.email.trim();
  if (phone.length === 0 && email.length === 0) {
    return '请至少填写电话或邮箱';
  }
  if (phone.length > 0) {
    const digits: string = phone.replace(/[^0-9]/g, '');
    if (phone.length > 30 || !/^\+?[0-9()\- ]+$/.test(phone) ||
      digits.length < 5 || digits.length > 20) {
      return '请输入有效的电话号码';
    }
  }
  if (email.length > 0 && (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))) {
    return '请输入有效的邮箱地址';
  }
  return '';
}

export function filterCards(cards: Card[], query: string, group: string, favoritesOnly: boolean): Card[] {
  const search: string = query.trim().toLowerCase();
  return cards.filter((card: Card): boolean => {
    if (favoritesOnly && !card.favorite) {
      return false;
    }
    if (group !== '全部' && card.group !== group) {
      return false;
    }
    const text: string = [card.name, card.company, card.title, card.phone, card.email, card.group, card.notes]
      .join('\n').toLowerCase();
    return search.length === 0 || text.indexOf(search) >= 0;
  });
}

function escapeVCard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

// RFC 2425 limits content lines to 75 octets; continuation lines begin with a space.
function foldVCardLine(value: string): string {
  let result: string = '';
  let bytes: number = 0;
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    let character: string = value.charAt(index);
    let size: number = code < 128 ? 1 : (code < 2048 ? 2 : 3);
    if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      const next: number = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        character += value.charAt(++index);
        size = 4;
      }
    }
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += size;
  }
  return result;
}

export function toVCard(card: Card): string {
  const lines: string[] = [
    'BEGIN:VCARD', 'VERSION:3.0',
    'N:' + escapeVCard(card.name) + ';;;;',
    'FN:' + escapeVCard(card.name),
    'ORG:' + escapeVCard(card.company),
    'TITLE:' + escapeVCard(card.title),
    'TEL;TYPE=CELL:' + escapeVCard(card.phone),
    'EMAIL;TYPE=INTERNET:' + escapeVCard(card.email),
    'CATEGORIES:' + escapeVCard(card.group),
    'NOTE:' + escapeVCard(card.notes),
    'END:VCARD'
  ];
  return lines.map((line: string): string => foldVCardLine(line)).join('\r\n') + '\r\n';
}
