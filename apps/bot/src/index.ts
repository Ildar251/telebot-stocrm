import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import { connectDB, LinkModel } from './db'
import { downloadFileByGuid, getDeal, getDealAttaches } from './stocrm'

async function main() {
	const { BOT_TOKEN, MONGODB_URI, WEBAPP_URL } = process.env
	if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required')
	if (!MONGODB_URI) throw new Error('MONGODB_URI is required')
	if (!WEBAPP_URL) throw new Error('WEBAPP_URL is required')

	await connectDB(MONGODB_URI)

	const bot = new TelegramBot(BOT_TOKEN, { polling: true })
	const me = await bot.getMe()
	console.log(`Bot started: @${me.username} (id=${me.id})`)

	bot.on('polling_error', e => console.error('Polling error:', e))
	bot.on('message', msg => console.log('Got update:', msg.chat.id, msg.text))

	const safeReply = async (
		chatId: number,
		text: string,
		extra?: TelegramBot.SendMessageOptions
	) => {
		try {
			await bot.sendMessage(chatId, text, extra)
			console.log('Sent ->', chatId, text.slice(0, 80))
		} catch (e: any) {
			console.error('sendMessage error:', e?.response?.body || e?.message || e)
		}
	}

	async function sendAuthUI(chatId: number, url: string) {
		// 1) Inline-кнопка (всегда видна под сообщением)
		await safeReply(chatId, 'Вход в личный кабинет:', {
			reply_markup: {
				inline_keyboard: [[{ text: '🔐 Войти', web_app: { url } }]],
			},
		})
	
	}

	// /login — принудительный показ кнопки входа
	bot.onText(/^\/login(?:@\w+)?/, async msg => {
		try {
			await sendAuthUI(msg.chat.id, WEBAPP_URL!)
		} catch (e) {
			console.error('LOGIN handler error', e)
		}
	})

	// Универсальный обработчик сообщений
	bot.on('message', async msg => {
		const chatId = msg.chat.id
		const text = (msg.text || '').trim()

		// 1) Ловим /start и /start@username (с аргументами тоже)
		if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
			try {
				await sendAuthUI(chatId, WEBAPP_URL!)
			} catch (e) {
				console.error('START handler error', e)
			}
			return
		}

		// 2) Если обычный текст (не команда и не номер) — показываем кнопки для входа
		if (text && !text.startsWith('/') && !/^\d{4,}$/.test(text)) {
			await sendAuthUI(chatId, WEBAPP_URL!)
			return
		}

		// 3) Если это номер сделки — выполняем бизнес-логику
		if (text && /^\d{4,}$/.test(text)) {
			const telegramId = msg.from?.id
			if (!telegramId) return

			const link = await LinkModel.findOne({ telegram_id: telegramId })
			if (!link) {
				await safeReply(
					chatId,
					'Не могу найти авторизацию. Нажмите «Войти» и завершите вход через WebApp.'
				)
				return
			}

			const dealCode = text // <-- используем отдельную переменную
			try {
				const deal = await getDeal(dealCode)

				// Учитываем твой ответ: там есть CONTACT_ID и PAYER_DATA
				const dealContactId =
					deal?.CONTACT_ID ||
					deal?.PAYER_DATA ||
					deal?.CONTACT?.ID ||
					deal?.CONTACTID

				if (!dealContactId) {
					await safeReply(
						chatId,
						'Не удалось проверить сделку (нет CONTACT_ID).'
					)
					return
				}
				if (Number(dealContactId) !== Number(link.contact_id)) {
					await safeReply(chatId, 'Эта сделка не привязана к вашему контакту.')
					return
				}

				const attaches = await getDealAttaches(dealCode)
				if (!attaches || attaches.length === 0) {
					await safeReply(chatId, 'К сделке не прикреплены файлы.')
					return
				}

				await safeReply(
					chatId,
					`Нашёл ${attaches.length} файл(ов). Отправляю...`
				)

				for (const a of attaches) {
					const guid = (a as any).GUID || (a as any).guid || (a as any).Guid
					const name = (a as any).NAME || (a as any).name || 'file'
					if (!guid) continue
					try {
						const { buffer, contentType, filename } = await downloadFileByGuid(
							guid
						)
						await bot.sendDocument(
							chatId,
							buffer,
							{},
							{ filename: filename || name, contentType }
						)
						console.log('Sent doc ->', chatId, filename || name)
					} catch (err) {
						console.error('Send file error', err)
						await safeReply(chatId, `Не удалось отправить файл ${name}`)
					}
				}
			} catch (e) {
				console.error(e)
				await safeReply(
					chatId,
					'Ошибка при получении сделки или файлов. Попробуйте позже.'
				)
			}
		}
	})
}

main().catch(e => {
	console.error('Fatal:', e)
	process.exit(1)
})
