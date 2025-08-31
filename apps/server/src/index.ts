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
