<template>
	<main class="wrap">
		<header class="topbar">
			<h1>Личный кабинет</h1>

			<!-- Кнопка выхода только после входа -->
			<button v-if="authorized" class="secondary small" @click="logout">
				Выйти
			</button>
		</header>

		<!-- ====== БЛОК АВТОРИЗАЦИИ ====== -->
		<Transition name="fade" mode="out-in">
			<section v-if="!authorized" key="auth" class="auth-card">
				<h2>Вход по номеру телефона</h2>

				<!-- Шаг 1: ввод телефона -->
				<div v-if="authStep === 'phone'" class="box">
					<label>Телефон</label>
					<input
						v-model="phoneMasked"
						v-maska="'+# (###) ###-##-##'"
						placeholder="+7 (999) 000-00-00"
						inputmode="tel"
						@keyup.enter="requestCode"
					/>

					<small class="muted">
						Отправим SMS-код на: <code>{{ phonePretty || '—' }}</code>
					</small>

					<button
						type="button"
						:disabled="loading || !canSubmitPhone"
						@click="requestCode"
					>
						<span v-if="loading" class="spinner"></span>
						{{ loading ? 'Отправляем...' : 'Получить код' }}
					</button>

					<p v-if="message" class="msg">{{ message }}</p>
					<p class="hint">
						Откройте эту страницу из Telegram, чтобы авторизация сработала
						корректно.
					</p>
				</div>

				<!-- Шаг 2: ввод кода -->
				<div v-else-if="authStep === 'code'" class="box">
					<label>Код из SMS</label>
					<input
						v-model="smsCode"
						placeholder="4 цифры"
						inputmode="numeric"
						maxlength="6"
						@keyup.enter="verifyCode"
					/>

					<div class="muted">
						На номер <b>{{ phonePretty }}</b> отправлен код.
						<br />
						<template v-if="resendLeft > 0">
							Повторная отправка доступна через {{ resendLeft }}&nbsp;с.
						</template>
						<template v-else>
							<button class="linklike" @click="requestCode" :disabled="loading">
								Отправить код повторно
							</button>
						</template>
					</div>

					<div class="row g8">
						<button
							type="button"
							class="secondary"
							@click="backToPhone"
							:disabled="loading"
						>
							Назад
						</button>
						<button
							type="button"
							:disabled="loading || smsCode.trim().length < 3"
							@click="verifyCode"
						>
							<span v-if="loading" class="spinner"></span>
							{{ loading ? 'Проверяем...' : 'Подтвердить' }}
						</button>
					</div>

					<p v-if="message" class="msg">{{ message }}</p>
				</div>
			</section>
		</Transition>

		<!-- ====== СПИСОК СДЕЛОК ====== -->
		<Transition name="fade" mode="out-in">
			<section v-if="authorized" key="offers">
				<div v-if="offersLoading" class="msg">Загружаю сделки…</div>

				<div v-else>
					<div v-if="offers.length">
						<h2>Ваши сделки</h2>
						<ul class="offers">
							<li
								v-for="o in offers"
								:key="o.OFFER_ID"
								class="offer"
								@click="openOffer(o)"
							>
								<div class="row">
									<b>#{{ o.OFFER_ID }}</b>
									<span>{{ o.STATUS_NAME || '—' }}</span>
								</div>
								<div class="row sm">
									<span>{{ o.OFFER_CUSTOMER_NAME || '—' }}</span>
									<span>Сумма: {{ o.OFFER_SUM || '0.00' }}</span>
								</div>
								<div class="row sm">
									<span>Тел: {{ o.CONTACT_PROPERTY_PHONE }}</span>
									<span>{{ o.OFFER_LAST_CALL_TIMESTAMP || '' }}</span>
								</div>
							</li>
						</ul>
					</div>
					<div v-else class="muted">Сделок не найдено</div>
				</div>
			</section>
		</Transition>

		<!-- ====== МОДАЛКА С ФАЙЛАМИ СДЕЛКИ ====== -->
		<div v-if="selectedOffer" class="modal" @click.self="closeOffer">
			<div class="modal-card">
				<div class="modal-header">
					<b>Сделка #{{ selectedOffer.OFFER_ID }}</b>
					<button class="close" @click="closeOffer">✕</button>
				</div>

				<div v-if="attachesLoading" class="msg">Загружаю файлы…</div>

				<div v-else>
					<div v-if="!attaches.length" class="muted">Файлы не найдены</div>

					<div class="grid" v-else>
						<div v-for="a in attaches" :key="a.GUID" class="attach">
							<div class="name">{{ a.NAME || 'GUID ' + a.GUID }}</div>

							<!-- превью для картинок -->
							<img
								v-if="
									isImageMeta(String(a.META || a.EXTENSION || a.NAME || ''))
								"
								:src="`${apiBase}/file/${a.GUID}`"
								alt=""
							/>

							<button @click="sendOneToChat(a)" :disabled="sendingOne[a.GUID]">
								<span v-if="sendingOne[a.GUID]" class="spinner"></span>
								{{ sendingOne[a.GUID] ? 'Отправка…' : 'Отправить в чат' }}
							</button>

							<div class="meta">
								{{ (a.EXTENSION || '').toUpperCase() }}
								<span v-if="a.SIZE"> · {{ Math.round(a.SIZE / 1024) }} KB</span>
							</div>
						</div>

						<button
							class="primary btn-all"
							@click="sendAllToChat"
							:disabled="sendingFiles"
						>
							<span v-if="sendingFiles" class="spinner"></span>
							{{ sendingFiles ? 'Отправка…' : 'Отправить все файлы в чат' }}
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- ====== ТОСТ ====== -->
		<Transition name="fade">
			<div v-if="toast" class="toast">{{ toast }}</div>
		</Transition>
	</main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/** ====== Telegram WebApp ====== */
const tg = (window as any).Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || null

/** ====== UI state ====== */
const phoneMasked = ref('')
const smsCode = ref('')
const message = ref('')
const loading = ref(false)
const authorized = ref(false)
const toast = ref('')

type AuthStep = 'phone' | 'code'
const authStep = ref<AuthStep>('phone')

/** resend-кнопка (cooldown) */
const RESEND_COOLDOWN = 45
const resendLeft = ref(0)
let resendTimer: number | null = null

/** ====== API base ====== */
const apiBase = import.meta.env.VITE_API_BASE || '/api'

/** ====== LocalStorage helpers ====== */
const LS_KEYS = { auth: 'sto_auth_v2' } // { phone, contact_id, tg_id, ts }
function saveAuth(payload: any) {
	localStorage.setItem(LS_KEYS.auth, JSON.stringify(payload))
}
function loadAuth() {
	try {
		const raw = localStorage.getItem(LS_KEYS.auth)
		return raw ? JSON.parse(raw) : null
	} catch {
		return null
	}
}
function clearAuth() {
	localStorage.removeItem(LS_KEYS.auth)
}

/** ====== Helpers ====== */
function normalizePhone(masked: string): string {
	const d = masked.replace(/\D+/g, '')
	if (!d) return ''
	if (d.length === 11 && d.startsWith('8')) return '+7' + d.slice(1)
	if (d.length === 11 && d.startsWith('7')) return '+' + d
	if (!masked.startsWith('+')) return '+' + d
	return '+' + d
}
const phoneNormalized = computed(() => normalizePhone(phoneMasked.value))
const phonePretty = computed(() => phoneNormalized.value || '')

const canSubmitPhone = computed(() => /^\+7\d{10}$/.test(phoneNormalized.value))

function showToast(t: string, timeout = 1600) {
	toast.value = t
	window.setTimeout(() => (toast.value = ''), timeout)
}

/** ====== Mount (инициализация) ====== */
onMounted(async () => {
	const hasTG = !!tg
	const hasInit =
		!!tg?.initData && tg.initData.length > 0 && !!tg?.initDataUnsafe?.user?.id

	if (hasTG) {
		try {
			tg.ready()
			tg.expand()
			tg.disableVerticalSwipes?.()
			tg.setBackgroundColor?.('#303941')
			tg.setHeaderColor?.('secondary_bg_color')
		} catch {}
	}

	// Автовход
	const saved = loadAuth()
	if (saved?.phone && saved?.contact_id && saved?.tg_id) {
		phoneMasked.value = saved.phone.startsWith('+7')
			? `+7 (${saved.phone.slice(2, 5)}) ${saved.phone.slice(
					5,
					8
			  )}-${saved.phone.slice(8, 10)}-${saved.phone.slice(10, 12)}`
			: saved.phone

		authorized.value = true
		await loadOffersLinked()
	}

	// если нет initData — не блокируем, просто не сможем запросить код
	if (!hasInit) {
		message.value = ''
	}
})

/** ====== Шаг 1: запросить SMS-код ====== */
async function requestCode() {
	if (!canSubmitPhone.value) {
		message.value = 'Введите корректный номер в формате +7...'
		return
	}
	if (!tgUser?.id) {
		message.value = 'Откройте Mini App через Telegram'
		return
	}

	loading.value = true
	message.value = ''
	try {
		const res = await fetch(`${apiBase}/auth/request`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ phone: phoneNormalized.value, tg: pickTgUser() }),
		})
		const data = await res.json().catch(() => ({}))
		if (res.ok && data?.ok) {
			authStep.value = 'code'
			startResendTimer()
			showToast('Код отправлен')
			;(window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
				'success'
			)
		} else {
			message.value = data?.message || 'Не удалось отправить код'
		}
	} catch {
		message.value = 'Сеть недоступна. Попробуйте позже.'
	} finally {
		loading.value = false
	}
}

/** ====== Шаг 2: проверить код ====== */
async function verifyCode() {
	if (!smsCode.value.trim()) {
		message.value = 'Введите код из SMS'
		return
	}
	if (!tgUser?.id) {
		message.value = 'Откройте Mini App через Telegram'
		return
	}

	loading.value = true
	message.value = ''
	try {
		const res = await fetch(`${apiBase}/auth/verify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				phone: phoneNormalized.value,
				tg: pickTgUser(),
				code: smsCode.value.trim(),
			}),
		})
		const data = await res.json().catch(() => ({}))

		if (res.ok && data?.ok && data?.contact_id) {
			authorized.value = true
			saveAuth({
				phone: data.phone || phoneNormalized.value,
				contact_id: data.contact_id,
				tg_id: tgUser?.id || null,
				ts: Date.now(),
			})
			showToast('Вход выполнен')
			;(window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
				'success'
			)
			await loadOffersLinked()
		} else {
			message.value = data?.message || 'Код не подошёл'
		}
	} catch {
		message.value = 'Сеть недоступна. Попробуйте позже.'
	} finally {
		loading.value = false
	}
}

/** Назад со второго шага */
function backToPhone() {
	authStep.value = 'phone'
	message.value = ''
	smsCode.value = ''
	stopResendTimer()
}

/** resend таймер */
function startResendTimer() {
	resendLeft.value = RESEND_COOLDOWN
	stopResendTimer()
	resendTimer = window.setInterval(() => {
		if (resendLeft.value > 0) resendLeft.value--
		else stopResendTimer()
	}, 1000) as unknown as number
}
function stopResendTimer() {
	if (resendTimer) {
		clearInterval(resendTimer)
		resendTimer = null
	}
}

/** ====== Список сделок (по связке) ====== */
const offers = ref<any[]>([])
const offersLoading = ref(false)

async function loadOffersLinked() {
	const tgId = tg?.initDataUnsafe?.user?.id
	if (!tgId) return
	offersLoading.value = true
	try {
		const res = await fetch(`${apiBase}/offers/by-linked`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tg_id: tgId }),
		})
		const data = await res.json().catch(() => ({}))
		offers.value = Array.isArray(data?.data) ? data.data : []
	} catch {
		offers.value = []
	} finally {
		offersLoading.value = false
	}
}

/** ====== Файлы сделки ====== */
const selectedOffer = ref<any | null>(null)
const attaches = ref<any[]>([])
const attachesLoading = ref(false)
const filesCache = ref<Record<string, any[]>>({})

function isImageMeta(meta?: string) {
	if (!meta) return false
	return /^image\//i.test(meta) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(meta)
}

async function openOffer(o: any) {
	selectedOffer.value = o
	const id = String(o.OFFER_ID)
	const tgId = tg?.initDataUnsafe?.user?.id
	if (!tgId) {
		showToast('Откройте через Telegram')
		return
	}

	if (filesCache.value[id]) {
		attaches.value = filesCache.value[id]
		return
	}

	attachesLoading.value = true
	attaches.value = []
	try {
		const res = await fetch(`${apiBase}/offers/${id}/files?tg_id=${tgId}`)
		const data = await res.json().catch(() => ({}))
		const list = Array.isArray(data?.data) ? data.data : []
		filesCache.value[id] = list
		attaches.value = list
	} catch (e) {
		console.error('[WEBAPP] files error', e)
		filesCache.value[id] = []
		attaches.value = []
	} finally {
		attachesLoading.value = false
	}
}

function closeOffer() {
	selectedOffer.value = null
	attaches.value = []
}

/** ====== Отправка в чат ====== */
const sendingFiles = ref(false)
const sendingOne = ref<Record<string, boolean>>({})

async function sendOneToChat(a: any) {
	const chatId = tg?.initDataUnsafe?.user?.id
	if (!chatId || !selectedOffer.value) {
		showToast('Откройте через Telegram')
		return
	}
	sendingOne.value = { ...sendingOne.value, [a.GUID]: true }
	try {
		const res = await fetch(
			`${apiBase}/offers/${selectedOffer.value.OFFER_ID}/send-to-chat`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tg_id: chatId, chat_id: chatId, guid: a.GUID }),
			}
		)
		const data = await res.json().catch(() => ({}))
		if (res.ok) {
			showToast('Файл отправлен в чат')
			;(window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
				'success'
			)
		} else {
			showToast(data?.message || 'Не удалось отправить')
		}
	} catch {
		showToast('Сеть недоступна')
	} finally {
		sendingOne.value = { ...sendingOne.value, [a.GUID]: false }
	}
}

async function sendAllToChat() {
	const chatId = tg?.initDataUnsafe?.user?.id
	if (!chatId || !selectedOffer.value) {
		showToast('Откройте через Telegram')
		return
	}
	sendingFiles.value = true
	try {
		const res = await fetch(
			`${apiBase}/offers/${selectedOffer.value.OFFER_ID}/send-to-chat`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tg_id: chatId, chat_id: chatId }),
			}
		)
		const data = await res.json().catch(() => ({}))
		if (res.ok) {
			showToast(`Отправлено файлов: ${data?.sent ?? 0}`)
			;(window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
				'success'
			)
		} else {
			showToast(data?.message || 'Не удалось отправить')
		}
	} catch {
		showToast('Сеть недоступна')
	} finally {
		sendingFiles.value = false
	}
}

/** ====== Выход ====== */
function logout() {
	clearAuth()
	authorized.value = false
	authStep.value = 'phone'
	smsCode.value = ''
	message.value = ''
	stopResendTimer()

	selectedOffer.value = null
	attaches.value = []
	offers.value = []
	showToast('Вы вышли')
}

/** Упаковываем минимум данных о пользователе для /auth/* */
function pickTgUser() {
	if (!tgUser) return null
	return {
		id: tgUser.id,
		username: tgUser.username,
		first_name: tgUser.first_name,
		last_name: tgUser.last_name,
		language_code: tgUser.language_code,
	}
}
</script>

<style>
/* Базовые */
body {
	font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell,
		Noto Sans, sans-serif;
	background: linear-gradient(90deg, #252b31 43%, #303941 100%);
	color: #fff;
}
a {
	color: #ffe664;
	text-decoration: none;
}
.wrap {
	max-width: 460px;
	margin: 24px auto;
	padding: 16px;
}

/* Хедер */
.topbar {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 12px;
}
.topbar h1 {
	font-size: 20px;
	margin: 0;
}

/* Карточки, формы */
.auth-card {
	border: 1px solid #3a4450;
	background: #21272e;
	border-radius: 14px;
	padding: 16px;
}
.box {
	display: grid;
	gap: 12px;
}
label {
	font-size: 14px;
	opacity: 0.95;
}
input {
	padding: 10px 12px;
	border: 1px solid #3a4450;
	border-radius: 10px;
	font-size: 16px;
	background: #2a3138;
	color: #fff;
}
button {
	padding: 10px 12px;
	border-radius: 10px;
	border: none;
	cursor: pointer;
	background: #ffe664;
	color: #303941;
	font-weight: 600;
	transition: transform 0.05s ease;
}
button:active {
	transform: translateY(1px);
}
button.secondary {
	background: transparent;
	color: #ffe664;
	border: 1px solid #ffe664;
}
button.small {
	padding: 6px 10px;
	font-size: 14px;
}
button.linklike {
	background: transparent;
	border: none;
	color: #ffe664;
	padding: 0;
	cursor: pointer;
}

/* Текстики */
.msg {
	margin-top: 6px;
}
.hint,
.muted {
	opacity: 0.8;
	font-size: 12px;
}
code {
	background: #fff;
	color: #303941;
	border-radius: 6px;
	padding: 1px 6px;
}

/* Список сделок */
.offers {
	margin-top: 16px;
	display: grid;
	gap: 10px;
	padding-left: 0;
}
.offer {
	padding: 10px;
	border: 1px solid #3a4450;
	border-radius: 10px;
	background: #2a3138;
	list-style: none;
}
.row {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	align-items: center;
}
.row.sm {
	font-size: 12px;
	opacity: 0.92;
}
.row.g8 {
	display: flex;
	gap: 8px;
}

/* Модалка */
.modal {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.4);
	display: grid;
	place-items: center;
	padding: 16px;
	z-index: 50;
}
.modal-card {
	width: 100%;
	max-width: 720px;
	background: #21272e;
	border: 1px solid #3a4450;
	border-radius: 14px;
	padding: 14px;
}
.modal-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 8px;
}
.modal .close {
	background: transparent;
	border: none;
	color: #fff;
	font-size: 18px;
	cursor: pointer;
}

/* Файлы */
.grid {
	display: grid;
	gap: 12px;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}
.attach {
	border: 1px solid #3a4450;
	border-radius: 10px;
	padding: 10px;
	background: #2a3138;
}
.attach .name {
	font-weight: 600;
	margin-bottom: 6px;
}
.attach img {
	width: 100%;
	height: auto;
	border-radius: 8px;
	margin-bottom: 6px;
	display: block;
}
.attach .meta {
	font-size: 12px;
	opacity: 0.8;
	margin-top: 4px;
}
.btn-all {
	text-align: center;
	margin: 12px auto 0;
}

/* Тост */
.toast {
	position: fixed;
	left: 50%;
	bottom: 20px;
	transform: translateX(-50%);
	background: #111;
	padding: 10px 14px;
	border-radius: 12px;
	border: 1px solid #333;
}

/* Спиннер */
.spinner {
	width: 16px;
	height: 16px;
	border: 2px solid rgba(0, 0, 0, 0.25);
	border-top-color: rgba(0, 0, 0, 0.7);
	border-radius: 50%;
	display: inline-block;
	animation: spin 0.8s linear infinite;
	vertical-align: -2px;
	margin-right: 6px;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

/* Анимации */
.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
