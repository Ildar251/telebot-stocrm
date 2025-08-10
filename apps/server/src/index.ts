import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'

const BOT_TOKEN = process.env.BOT_TOKEN
const { MONGODB_URI, STO_BASE_URL, STO_SID, CORS_ORIGIN, PORT } = process.env

// ====== Mongo модель ======
const linkSchema = new mongoose.Schema({
	telegram_id: { type: Number, index: true, unique: true },
	contact_id: { type: Number, index: true },
	phone: String,
	username: String,
	first_name: String,
	last_name: String,
	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
})
const LinkModel = mongoose.models.Link || mongoose.model('Link', linkSchema)

// middleware для получения связки
async function getLinkOr403(req: any, res: any) {
	const tgId = Number(req.body?.tg_id || req.query?.tg_id)
	if (!tgId) {
		res.status(401).json({ ok: false, message: 'tg_id required' })
		return null
	}
	const link = await LinkModel.findOne({ telegram_id: tgId })
	if (!link) {
		res.status(403).json({ ok: false, message: 'not linked' })
		return null
	}
	return link
}

async function ensureOfferBelongsTo(link: any, offerId: string) {
	const payload = { SID: STO_SID, FILTER: { OFFER_ID: Number(offerId) } }
	const r = await fetch(
		`${STO_BASE_URL}/api/external/v1/offers/get_from_filter`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		}
	)
	const json: any = await r.json().catch(() => ({}))
	const o = json?.RESPONSE?.DATA?.[0]
	return o && Number(o.CONTACT_ID) === Number(link.contact_id)
}

// ====== Utils ======
function normalizeTo7(phone: string) {
	const d = (phone || '').replace(/\D+/g, '')
	if (!d) return ''
	if (d.length === 11 && d.startsWith('8')) return '7' + d.slice(1)
	if (d.length === 11 && d.startsWith('7')) return d
	if (d.length === 10) return '7' + d
	return d
}

// Помести это рядом с normalizeTo7 (выше main)
async function findContactIdByPhone(phone: string): Promise<number | null> {
	if (!STO_BASE_URL || !STO_SID) return null
	const phone7 = normalizeTo7(phone) // 8XXXXXXXXXX -> 7XXXXXXXXXX и т.п.

	const url = `${STO_BASE_URL}/api/external/v1/offers/get_from_filter`
	const payload = {
		SID: STO_SID,
		FILTER: { CONTACT_PROPERTY_PHONE: phone7 },
	}

	try {
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		const json: any = await r.json().catch(() => ({}))
		const offer = json?.RESPONSE?.DATA?.[0]
		const contactId = offer?.CONTACT_ID
		return contactId ? Number(contactId) : null
	} catch {
		return null
	}
}

// Кэш в памяти: GUID → имя файла
const fileNameMap = new Map<string, string>()

// Возвратим contentType тоже
async function fetchStoFile(guid: string): Promise<{
	buffer: Buffer
	fileName: string
	contentType: string
}> {
	if (!STO_BASE_URL || !STO_SID) {
		throw new Error('STO_BASE_URL or STO_SID not configured')
	}

	const r = await fetch(`${STO_BASE_URL}/api/external/v1/files/get_file`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ GUID: guid, SID: STO_SID }),
	})

	const contentType =
		r.headers.get('content-type') || 'application/octet-stream'

	// Если вдруг вернулся JSON — это ошибка STO (редирект/авторизация)
	if (contentType.includes('application/json')) {
		const j = await r.json().catch(() => ({}))
		console.error('[STO get_file JSON]', j)
		throw new Error(`STO returned JSON instead of file: ${JSON.stringify(j)}`)
	}

	const arrayBuffer = await r.arrayBuffer()
	const buffer = Buffer.from(arrayBuffer)

	// имя из заголовка или из кэша, или GUID
	const cd = r.headers.get('content-disposition') || ''
	const headerName = cd.match(/filename="(.+?)"/)?.[1]
	const cached = fileNameMap.get(guid)
	const fileName = cached || headerName || guid

	return { buffer, fileName, contentType }
}

async function sendToTelegramDocument(params: {
	chatId: number
	buffer: Buffer
	filename: string
	contentType?: string
	caption?: string
}) {
	const { chatId, buffer, filename, contentType, caption } = params
	const token = process.env.BOT_TOKEN
	if (!token) throw new Error('BOT_TOKEN is required on server')

	// ИСПОЛЬЗУЕМ ВСТРОЕННЫЕ FormData/Blob (undici):
	const form = new FormData()
	form.append('chat_id', String(chatId))
	if (caption) form.append('caption', caption)

	const blob = new Blob([new Uint8Array(buffer)], {
		type: contentType || 'application/octet-stream',
	})

	form.append('document', blob, filename)

	// НИКАКИХ ручных заголовков content-type — fetch сам проставит boundary
	const tgUrl = `https://api.telegram.org/bot${token}/sendDocument`
	const tgRes = await fetch(tgUrl, { method: 'POST', body: form })
	const tgJson = await tgRes.json().catch(() => ({}))

	if (!tgRes.ok || !tgJson?.ok) {
		throw new Error(
			`Telegram sendDocument failed: ${tgRes.status} ${JSON.stringify(
				tgJson
			).slice(0, 300)}`
		)
	}

	return tgJson
}

async function main() {
	if (!MONGODB_URI) throw new Error('MONGODB_URI is required')
	await mongoose.connect(MONGODB_URI)
	console.log('Mongo connected')

	const app = express()
	app.use(express.json())

	app.use(
		cors({
			origin: CORS_ORIGIN?.split(',').map(s => s.trim()) || [
				/^http:\/\/localhost:\d+$/,
			],
		})
	)

	// ===== Авторизация =====
	// POST /api/auth
	app.post('/api/auth', async (req, res) => {
		try {
			const { phone, tg } = req.body || {}
			if (!tg?.id)
				return res.status(400).json({ message: 'telegram user is required' })

			const existing = await LinkModel.findOne({ telegram_id: Number(tg.id) })
			if (existing?.contact_id) {
				// Если телефон уже привязан и введённый номер НЕ совпадает — ошибка
				if (phone) {
					const normalize = (src: string) => {
						const dd = (src || '').replace(/\D+/g, '')
						if (dd.length === 11 && dd.startsWith('8')) return '7' + dd.slice(1)
						if (dd.length === 11 && dd.startsWith('7')) return dd
						if (dd.length === 10) return '7' + dd
						return dd
					}
					const savedNorm = normalize(existing.phone)
					const inputNorm = normalize(phone)
					if (savedNorm !== inputNorm) {
						return res.status(400).json({
							message: 'Этот Telegram уже привязан к другому контакту',
						})
					}
				}

				// Обновляем имя/username, но телефон и contact_id не трогаем
				await LinkModel.updateOne(
					{ telegram_id: Number(tg.id) },
					{
						$set: {
							username: tg.username || '',
							first_name: tg.first_name || '',
							last_name: tg.last_name || '',
							updated_at: new Date(),
						},
					}
				)
				return res.json({
					ok: true,
					contact_id: Number(existing.contact_id),
					phone: existing.phone || null,
				})
			}

			// 2) Связи нет — создаём её по телефону в STO
			if (!phone) return res.status(400).json({ message: 'phone is required' })
			if (!STO_BASE_URL || !STO_SID) {
				return res
					.status(500)
					.json({ message: 'STO_BASE_URL/STO_SID not configured' })
			}

			// Нормализация к 7XXXXXXXXXX
			const d = (phone || '').replace(/\D+/g, '')
			const phone7 =
				d.length === 11 && d.startsWith('8')
					? '7' + d.slice(1)
					: d.length === 11 && d.startsWith('7')
					? d
					: d.length === 10
					? '7' + d
					: d
			const toPlus7 = (src: string) => {
				const dd = (src || '').replace(/\D+/g, '')
				if (dd.length === 11 && dd.startsWith('8')) return '+7' + dd.slice(1)
				if (dd.length === 11 && dd.startsWith('7')) return '+' + dd
				return '+' + dd
			}

			const url = `${STO_BASE_URL}/api/external/v1/offers/get_from_filter`
			const payload = {
				SID: STO_SID,
				FILTER: { CONTACT_PROPERTY_PHONE: phone7 },
			}

			const stoResp = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			const stoJson: any = await stoResp.json().catch(() => ({}))

			const offer = stoJson?.RESPONSE?.DATA?.[0]
			const contactId = offer?.CONTACT_ID
			if (!contactId) {
				return res
					.status(404)
					.json({ message: 'Контакт по телефону не найден' })
			}

			await LinkModel.updateOne(
				{ telegram_id: Number(tg.id) },
				{
					$set: {
						contact_id: Number(contactId),
						phone: toPlus7(phone),
						username: tg.username || '',
						first_name: tg.first_name || '',
						last_name: tg.last_name || '',
						updated_at: new Date(),
					},
					$setOnInsert: { created_at: new Date() },
				},
				{ upsert: true }
			)

			return res.json({
				ok: true,
				contact_id: Number(contactId),
				phone: toPlus7(phone),
			})
		} catch (e) {
			console.error('/api/auth error', e)
			return res.status(500).json({ message: 'internal error' })
		}
	})
	// НОВЫЙ маршрут
	app.post('/api/offers/by-linked', async (req, res) => {
		try {
			const { tg_id } = req.body || {}
			if (!tg_id) return res.status(400).json({ message: 'tg_id is required' })
			if (!STO_BASE_URL || !STO_SID) {
				return res
					.status(500)
					.json({ message: 'STO_BASE_URL/STO_SID not configured' })
			}

			const link = await LinkModel.findOne({ telegram_id: Number(tg_id) })
			if (!link?.phone) {
				return res.status(404).json({ message: 'Связка не найдена' })
			}

			// нормализуем к 7XXXXXXXXXX для STO
			const d = (link.phone || '').replace(/\D+/g, '')
			const phone7 =
				d.length === 11 && d.startsWith('8')
					? '7' + d.slice(1)
					: d.length === 11 && d.startsWith('7')
					? d
					: d.length === 10
					? '7' + d
					: d

			const url = `${STO_BASE_URL}/api/external/v1/offers/get_from_filter`
			const payload = {
				SID: STO_SID,
				FILTER: { CONTACT_PROPERTY_PHONE: phone7 },
			}

			const r = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
			const json: any = await r.json().catch(() => ({}))

			const data = json?.RESPONSE?.DATA ?? []
			const total = json?.RESPONSE?.TOTAL_COUNT ?? data.length ?? 0
			return res.json({ ok: true, total, data })
		} catch (e) {
			console.error('/api/offers/by-linked error', e)
			return res.status(500).json({ message: 'internal error' })
		}
	})

	// POST /api/offers/by-phone
	// body: { phone: string }
	app.post('/api/offers/me', async (req, res) => {
		const link = await getLinkOr403(req, res)
		if (!link) return

		const payload = {
			SID: STO_SID,
			FILTER: { CONTACT_ID: Number(link.contact_id) },
		}
		const r = await fetch(
			`${STO_BASE_URL}/api/external/v1/offers/get_from_filter`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			}
		)
		const json: any = await r.json().catch(() => ({}))
		let data = json?.RESPONSE?.DATA ?? []
		data = data.filter(
			(o: any) => Number(o.CONTACT_ID) === Number(link.contact_id)
		)

		res.json({ ok: true, data })
	})

	// ===== Файлы сделки =====
	// ===== Файлы сделки =====
	app.get('/api/offers/:id/files', async (req, res) => {
		const link = await getLinkOr403(req, res)
		if (!link) return

		const id = String(req.params.id || '').replace(/\D+/g, '')
		if (!id) return res.status(400).json({ ok: false, message: 'Bad offer id' })

		const ok = await ensureOfferBelongsTo(link, id)
		if (!ok) return res.status(403).json({ ok: false, message: 'Forbidden' })

		if (!STO_BASE_URL || !STO_SID) {
			return res
				.status(500)
				.json({ ok: false, message: 'STO_BASE_URL/STO_SID not configured' })
		}

		// небольший помощник, чтобы красиво логировать кусок ответа
		const peek = (obj: any, max = 800) =>
			typeof obj === 'string'
				? obj.slice(0, max)
				: JSON.stringify(obj).slice(0, max)

		try {
			// Попытка А: get_filtered_attaches (по доке, которую ты присылал)
			const urlA = `${STO_BASE_URL}/api/external/v1/files/get_filtered_attaches?SID=${encodeURIComponent(
				STO_SID!
			)}`

			const bodyA = { FILTER: { ENTITY: 'OFFER', CODE: Number(id) } }

			const rA = await fetch(urlA, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(bodyA),
			})

			const jsonA: any = await rA.json().catch(() => ({}))
			console.log('[files A resp]', peek(jsonA))

			let data: any[] = Array.isArray(jsonA)
				? jsonA
				: Array.isArray(jsonA?.RESPONSE?.DATA)
				? jsonA.RESPONSE.DATA
				: []

			// Если первый способ ничего не дал — пробуем вариант B: get_list с OFFER_ID
			if (!data.length) {
				const urlB = `${STO_BASE_URL}/api/external/v1/files/get_list`
				const bodyB = { SID: STO_SID, FILTER: { OFFER_ID: Number(id) } }

				const rB = await fetch(urlB, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(bodyB),
				})

				const jsonB: any = await rB.json().catch(() => ({}))
				console.log('[files B resp]', peek(jsonB))

				data = Array.isArray(jsonB)
					? jsonB
					: Array.isArray(jsonB?.RESPONSE?.DATA)
					? jsonB.RESPONSE.DATA
					: []
			}

			// обновим кэш имён
			for (const f of data) {
				if (f?.GUID && f?.NAME) fileNameMap.set(String(f.GUID), String(f.NAME))
			}

			return res.json({ ok: true, total: data.length || 0, data })
		} catch (e) {
			console.error('[files] error', e)
			return res.status(500).json({ ok: false, message: 'internal error' })
		}
	})

	// ===== Отправка файлов в Telegram =====
	app.post('/api/offers/:id/send-to-chat', async (req, res) => {
		const link = await getLinkOr403(req, res)
		if (!link) return

		const id = String(req.params.id || '').replace(/\D+/g, '')
		if (!id) return res.status(400).json({ ok: false, message: 'Bad offer id' })

		const ok = await ensureOfferBelongsTo(link, id)
		if (!ok) return res.status(403).json({ ok: false, message: 'Forbidden' })

		// дальше твоя логика отправки
	})

	const port = Number(PORT) || 3001
	app.listen(port, () => console.log(`API server listening on :${port}`))
}

main().catch(err => {
	console.error('SERVER FATAL:', err)
	process.exit(1)
})
