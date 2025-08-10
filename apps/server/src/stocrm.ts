import axios from 'axios'

const sto = () => {
	const base = `https://${process.env.STOCRM_DOMAIN}/api/external/v1`
	const SID = process.env.STOCRM_SID
	const instance = axios.create({
		baseURL: base,
		headers: { 'Content-Type': 'application/json' },
		timeout: 20000,
	})
	return { instance, SID }
}

export async function getDeal(dealCode: string) {
	const { instance, SID } = sto()

	try {
		const { data } = await instance.post(`/offers/get`, { SID, CODE: dealCode })

		const payload = data?.RESPONSE?.DATA ?? data
		if (payload) return payload
	} catch {}

	const { data } = await instance.post(`/offers/get_from_filter`, {
		SID,
		FILTER: { OFFER_ID: dealCode },
	})
	const list = data?.RESPONSE?.DATA
	if (Array.isArray(list) && list.length > 0) {
		return list[0]
	}
	return null
}

export async function getDealAttaches(dealCode: string) {
	const { instance, SID } = sto()
	const url = `/files/get_filtered_attaches?SID=${SID}`
	const payload = { FILTER: { ENTITY: 'OFFER', CODE: dealCode } }
	const { data } = await instance.post(url, payload)
	// Нормализуем в массив
	const arr = data?.RESPONSE?.DATA ?? data
	return Array.isArray(arr) ? arr : arr ? [arr] : []
}

export async function downloadFileByGuid(guid: string) {
	const { instance, SID } = sto()
	const url = `/files/get_file?SID=${SID}`
	const { data, headers } = await instance.post(
		url,
		{ GUID: guid },
		{ responseType: 'arraybuffer' }
	)
	const contentType = headers['content-type'] || 'application/octet-stream'
	const disposition = headers['content-disposition'] || ''
	let filename = 'file'
	const m =
		/filename\*=UTF-8''([^;\n]+)/i.exec(disposition) ||
		/filename="?([^\";\n]+)/i.exec(disposition)
	if (m) filename = decodeURIComponent(m[1])
	return { buffer: Buffer.from(data), contentType, filename }
}
