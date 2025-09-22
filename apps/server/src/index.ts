import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'

const {
	MONGODB_URI,
	STO_BASE_URL,
	STO_SID,
	CORS_ORIGIN,
	PORT,
	SMSC_LOGIN,
	SMSC_PASSWORD,
	BOT_TOKEN,
} = process.env

// ===== Mongo модель =====
const linkSchema = new mongoose.Schema({
	telegram_id: { type: Number, index: true, unique: true },
	contact_id: { type: Number, index: true },
	phone: String,
	username: String,
	first_name: String,
	last_name: String,
	sms_code: String,
	sms_expire: Date,
	created_at: { type: Date, default: Date.now },
	updated_at: { type: Date, default: Date.now },
})
const LinkModel = mongoose.models.Link || mongoose.model('Link', linkSchema)

// middleware: получить связку или 401/403
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
// проверка, что сделка принадлежит этому contact_id
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
	return !!o && Number(o.CONTACT_ID) === Number(link.contact_id)
}

// STO: файл по GUID
const fileNameMap = new Map<string, string>()
async function fetchStoFile(guid: string): Promise<{
	buffer: Buffer
	fileName: string
	contentType: string
}> {
	if (!STO_BASE_URL || !STO_SID)
		throw new Error('STO_BASE_URL or STO_SID not configured')

	const r = await fetch(`${STO_BASE_URL}/api/external/v1/files/get_file`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ GUID: guid, SID: STO_SID }),
	})
	const contentType =
		r.headers.get('content-type') || 'application/octet-stream'
	if (contentType.includes('application/json')) {
		const j = await r.json().catch(() => ({}))
		throw new Error(`STO returned JSON instead of file: ${JSON.stringify(j)}`)
	}
	const buffer = Buffer.from(await r.arrayBuffer())
	const cd = r.headers.get('content-disposition') || ''
	const headerName = cd.match(/filename="(.+?)"/)?.[1]
	const cached = fileNameMap.get(guid)
	const fileName = cached || headerName || guid
	return { buffer, fileName, contentType }
}

// Telegram: отправка документа
async function sendToTelegramDocument(params: {
	chatId: number
	buffer: Buffer
	filename: string
	contentType?: string
	caption?: string
}) {
	const { chatId, buffer, filename, contentType, caption } = params
	if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required on server')

	const form = new FormData()
	form.append('chat_id', String(chatId))
	if (caption) form.append('caption', caption)
	const blob = new Blob([new Uint8Array(buffer)], {
		type: contentType || 'application/octet-stream',
	})
	form.append('document', blob, filename)

	const tgRes = await fetch(
		`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
		{
			method: 'POST',
			body: form,
		}
	)
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

// ====== SMSC отправка =====
async function sendSms(phone: string, text: string) {
	const url = `https://smsc.ru/sys/send.php?login=${encodeURIComponent(
		SMSC_LOGIN!
	)}&psw=${encodeURIComponent(SMSC_PASSWORD!)}&phones=${encodeURIComponent(
		phone
	)}&mes=${encodeURIComponent(text)}&fmt=3`
	const r = await fetch(url)
	const json: any = await r.json().catch(() => ({}))
	if (json.error) throw new Error(json.error)
	return json
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
// ===== Проксировать файл по GUID =====
app.get('/api/file/:guid', async (req, res) => {
  try {
    const { guid } = req.params
    if (!guid) return res.status(400).send('guid required')

    const url = `${STO_BASE_URL}/api/external/v1/files/get_file`
    const payload = { SID: STO_SID, GUID: guid }

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!r.ok) {
      return res.status(500).send('file fetch error')
    }

    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      r.headers.get('content-disposition') || `inline; filename="${guid}"`
    )

    const buffer = Buffer.from(await r.arrayBuffer())
    res.end(buffer)
  } catch (e) {
    console.error('/api/file/:guid error', e)
    res.status(500).send('file error')
  }
})

// ---- Отправка файлов сделки в Telegram ----
	// body: { tg_id, chat_id, guid? }
	app.post('/api/offers/:id/send-to-chat', async (req, res) => {
		const link = await getLinkOr403(req, res)
		if (!link) return

		const id = String(req.params.id || '').replace(/\D+/g, '')
		if (!id) return res.status(400).json({ ok: false, message: 'Bad offer id' })
		const allowed = await ensureOfferBelongsTo(link, id)
		if (!allowed)
			return res.status(403).json({ ok: false, message: 'Forbidden' })

		const { chat_id, guid } = req.body || {}
		if (!chat_id)
			return res.status(400).json({ ok: false, message: 'chat_id required' })

		try {
			let guids: string[] = []
			if (guid) {
				guids = [String(guid)]
			} else {
				const url = `${STO_BASE_URL}/api/external/v1/files/get_filtered_attaches?SID=${encodeURIComponent(
					STO_SID!
				)}`
				const rr = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						FILTER: { ENTITY: 'OFFER', CODE: Number(id) },
					}),
				})
				const jj: any = await rr.json().catch(() => ({}))
				const list = Array.isArray(jj?.RESPONSE?.DATA) ? jj.RESPONSE.DATA : []
				guids = list.map((x: any) => String(x.GUID)).filter(Boolean)
				for (const a of list) {
					if (a?.GUID && a?.NAME)
						fileNameMap.set(String(a.GUID), String(a.NAME))
				}
			}

			let sent = 0
			for (const g of guids) {
				try {
					const { buffer, fileName, contentType } = await fetchStoFile(g)
					await sendToTelegramDocument({
						chatId: Number(chat_id),
						buffer,
						filename: fileName,
						contentType,
						caption: `Файл сделки #${id}`,
					})
					sent++
				} catch (e: any) {
					console.error('[send-to-chat] one file failed:', g, e?.message || e)
				}
			}
			res.json({ ok: true, sent })
		} catch (e: any) {
			console.error('send-to-chat error:', e?.message || e)
			res.status(500).json({ ok: false, message: 'send-to-chat failed' })
		}
	})


	// ===== Запрос SMS =====
	app.post('/api/auth/request', async (req, res) => {
		try {
			const { phone, tg } = req.body || {}
			if (!phone || !tg?.id)
				return res
					.status(400)
					.json({ ok: false, message: 'phone and tg_id required' })

			const phone7 = normalizeTo7(phone)
			if (!phone7)
				return res.status(400).json({ ok: false, message: 'invalid phone' })

			const code = String(Math.floor(1000 + Math.random() * 9000))
			const expire = new Date(Date.now() + 5 * 60 * 1000) // 5 минут

			await LinkModel.updateOne(
				{ telegram_id: Number(tg.id) },
				{
					$set: {
						phone: '+' + phone7,
						sms_code: code,
						sms_expire: expire,
						updated_at: new Date(),
					},
				},
				{ upsert: true }
			)

			await sendSms('+' + phone7, `Код подтверждения: ${code}`)

			return res.json({ ok: true, message: 'Код отправлен' })
		} catch (e: any) {
			console.error('/api/auth/request error', e)
			return res.status(500).json({ ok: false, message: 'sms send error' })
		}
	})

	// ====== Список сделок по связке ======
app.post('/api/offers/by-linked', async (req, res) => {
  try {
    const { tg_id } = req.body || {}
    if (!tg_id) return res.status(400).json({ ok: false, message: 'tg_id required' })

    const link = await LinkModel.findOne({ telegram_id: Number(tg_id) })
    if (!link?.contact_id) {
      return res.json({ ok: true, data: [] })
    }

    const url = `${STO_BASE_URL}/api/external/v1/offers/get_from_filter`
    const payload = {
      SID: STO_SID,
      FILTER: { CONTACT_ID: link.contact_id }, // 👈 ключевой момент
    }

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await r.json().catch(() => ({}))
    const offers = json?.RESPONSE?.DATA || []

    return res.json({ ok: true, data: offers })
  } catch (e) {
    console.error('/api/offers/by-linked error', e)
    return res.status(500).json({ ok: false, message: 'offers error' })
  }
})
// ===== Получить файлы сделки =====
// ===== Получить файлы сделки =====
app.get('/api/offers/:id/files', async (req, res) => {
  try {
    const { id } = req.params
    const { tg_id } = req.query
    if (!tg_id) {
      return res.status(400).json({ ok: false, message: 'tg_id required' })
    }

    // проверка привязки
    const link = await LinkModel.findOne({ telegram_id: Number(tg_id) })
    if (!link?.contact_id) {
      return res.status(403).json({ ok: false, message: 'not linked' })
    }

    // правильный эндпоинт
    const url = `${STO_BASE_URL}/api/external/v1/files/get_filtered_attaches`
    const payload = {
      SID: STO_SID,
      FILTER: { ENTITY: 'OFFER', CODE: String(id) },
    }

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json: any = await r.json().catch(() => ({}))
    const files = json?.RESPONSE?.DATA || []

    return res.json({ ok: true, data: Array.isArray(files) ? files : [] })
  } catch (e) {
    console.error('/api/offers/:id/files error', e)
    return res.status(500).json({ ok: false, message: 'files error' })
  }
})



	// ===== Проверка кода =====
	app.post('/api/auth/verify', async (req, res) => {
		try {
			const { phone, tg, code } = req.body || {}
			if (!phone || !tg?.id || !code)
				return res.status(400).json({ ok: false, message: 'params required' })

			const link = await LinkModel.findOne({ telegram_id: Number(tg.id) })
			if (!link)
				return res.status(404).json({ ok: false, message: 'link not found' })

			if (
				!link.sms_code ||
				!link.sms_expire ||
				new Date(link.sms_expire) < new Date()
			) {
				return res.status(400).json({ ok: false, message: 'code expired' })
			}
			if (link.sms_code !== code) {
				return res.status(400).json({ ok: false, message: 'wrong code' })
			}

			// тут нужно найти contact_id в STO
			const phone7 = normalizeTo7(phone)
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
			const offer = json?.RESPONSE?.DATA?.[0]
			const contactId = offer?.CONTACT_ID

			if (!contactId)
				return res.status(404).json({ ok: false, message: 'Контакт не найден' })

			// привязываем
			await LinkModel.updateOne(
				{ telegram_id: Number(tg.id) },
				{
					$set: {
						contact_id: Number(contactId),
						phone: '+' + phone7,
						sms_code: null,
						sms_expire: null,
						username: tg.username || '',
						first_name: tg.first_name || '',
						last_name: tg.last_name || '',
						updated_at: new Date(),
					},
				}
			)

			return res.json({ ok: true, contact_id: contactId, phone: '+' + phone7 })
		} catch (e) {
			console.error('/api/auth/verify error', e)
			return res.status(500).json({ ok: false, message: 'verify error' })
		}
	})

	const port = Number(PORT) || 3001
	app.listen(port, () => console.log(`API server listening on :${port}`))
}

main().catch(err => {
	console.error('SERVER FATAL:', err)
	process.exit(1)
})
