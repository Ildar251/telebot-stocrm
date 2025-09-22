"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeal = getDeal;
exports.getDealAttaches = getDealAttaches;
exports.downloadFileByGuid = downloadFileByGuid;
const axios_1 = __importDefault(require("axios"));
const sto = () => {
    const base = `https://${process.env.STOCRM_DOMAIN}/api/v1/external/v1`;
    const SID = process.env.STOCRM_SID;
    const instance = axios_1.default.create({
        baseURL: base,
        headers: { 'Content-Type': 'application/json' },
        // Optional: timeout
        timeout: 20000,
    });
    return { instance, SID };
};
async function getDeal(dealCode) {
    const { instance, SID } = sto();
    const url = `/deal/get?SID=${SID}`;
    const { data } = await instance.post(url, { CODE: dealCode });
    return data;
}
async function getDealAttaches(dealCode) {
    const { instance, SID } = sto();
    const url = `/files/get_filtered_attaches?SID=${SID}`;
    const payload = { FILTER: { ENTITY: 'OFFER', CODE: dealCode } };
    const { data } = await instance.post(url, payload);
    const list = data?.RESPONSE?.DATA || [];
    return Array.isArray(list) ? list : [];
}
async function downloadFileByGuid(guid) {
    const { instance, SID } = sto();
    const url = `/files/get_file?SID=${SID}`;
    const { data, headers } = await instance.post(url, { GUID: guid }, { responseType: 'arraybuffer' });
    const contentType = headers['content-type'] || 'application/octet-stream';
    const disposition = headers['content-disposition'] || '';
    let filename = 'file';
    const m = /filename\*=UTF-8''([^;\n]+)/i.exec(disposition) || /filename="?([^";\n]+)/i.exec(disposition);
    if (m)
        filename = decodeURIComponent(m[1]);
    return { buffer: Buffer.from(data), contentType, filename };
}
