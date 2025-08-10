import axios from 'axios';

const sto = () => {
  const base = `https://${process.env.STOCRM_DOMAIN}/api/v1/external/v1`;
  const SID = process.env.STOCRM_SID;
  const instance = axios.create({
    baseURL: base,
    headers: { 'Content-Type': 'application/json' },
    // Optional: timeout
    timeout: 20000,
  });
  return { instance, SID };
};

export async function getDeal(dealCode: string) {
  const { instance, SID } = sto();
  const url = `/deal/get?SID=${SID}`;
  const { data } = await instance.post(url, { CODE: dealCode });
  return data;
}

export async function getDealAttaches(dealCode: string) {
  const { instance, SID } = sto();
  const url = `/files/get_filtered_attaches?SID=${SID}`;
  const payload = { FILTER: { ENTITY: 'OFFER', CODE: dealCode } };
  const { data } = await instance.post(url, payload);
  // API may return array or object; normalize to array
  return Array.isArray(data) ? data : [data];
}

export async function downloadFileByGuid(guid: string) {
  const { instance, SID } = sto();
  const url = `/files/get_file?SID=${SID}`;
  const { data, headers } = await instance.post(url, { GUID: guid }, { responseType: 'arraybuffer' });
  const contentType = headers['content-type'] || 'application/octet-stream';
  const disposition = headers['content-disposition'] || '';
  let filename = 'file';
  const m = /filename\*=UTF-8''([^;\n]+)/i.exec(disposition) || /filename="?([^";\n]+)/i.exec(disposition);
  if (m) filename = decodeURIComponent(m[1]);
  return { buffer: Buffer.from(data), contentType, filename };
}
