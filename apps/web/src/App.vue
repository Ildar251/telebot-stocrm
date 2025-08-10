<template>
	<main class="wrap">
		<header class="topbar">
			<h1>Личный кабинет</h1>
			<button v-if="authorized" class="secondary small" @click="logout">
				Выйти
			</button>
		</header>

		<!-- ФОРМА ВХОДА -->
		<Transition name="fade" mode="out-in">
			<div v-if="!authorized" key="auth" class="box">
				<label>Телефон</label>

				<input
					v-model="phoneMasked"
					v-maska="'+# (###) ###-##-##'"
					placeholder="+7 (999) 000-00-00"
					inputmode="tel"
					@keyup.enter="submitPhone"
				/>

				<small class="muted">
					Будет отправлено как: <code>{{ phoneNormalized || '—' }}</code>
				</small>

				<button type="button" :disabled="loading" @click.prevent="submitPhone">
					<span v-if="loading" class="spinner"></span>
					{{ loading ? 'Загрузка...' : 'Войти' }}
				</button>

				<p v-if="message" class="msg">{{ message }}</p>
				<p class="hint">
					Откройте эту страницу из Telegram, чтобы авторизация сработала.
				</p>
			</div>
		</Transition>

		<!-- СПИСОК СДЕЛОК -->
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

		<!-- МОДАЛКА С ФАЙЛАМИ -->
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

		<!-- Тост -->
		<Transition name="fade">
			<div v-if="toast" class="toast">{{ toast }}</div>
		</Transition>
	</main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const tg = (window as any).Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || null

const phoneMasked = ref('')
const message = ref('')
const loading = ref(false)
const initData = ref('')
const authorized = ref(false)
const toast = ref('')

const apiBase = import.meta.env.VITE_API_BASE || '/api'

/** --- localStorage helpers --- */
const LS_KEYS = {
	auth: 'sto_auth_v1', // { phone, contact_id, tg_id, ts }
}
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
async function loadOffersLinked() {
	const tg = (window as any).Telegram?.WebApp
	const tgId = tg?.initDataUnsafe?.user?.id
	if (!tgId) return
	offersLoading.value = true
	try {
		const res = await fetch(`${apiBase}/offers/by-linked`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tg_id: tgId }),
		})
		const data = await res.json()
		offers.value = Array.isArray(data?.data) ? data.data : []
	} finally {
		offersLoading.value = false
	}
}
/** --- UI helpers --- */
function showToast(t: string, timeout = 1600) {
	toast.value = t
	setTimeout(() => (toast.value = ''), timeout)
}

onMounted(async () => {
	const tg = (window as any).Telegram?.WebApp
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

	if (hasInit) {
		initData.value = tg.initData
	} else {
		initData.value = ''
	}

	// Восстановим авторизацию из localStorage
	const saved = loadAuth()
	if (saved?.phone && saved?.contact_id && saved?.tg_id) {
		// восстановим маску для поля (для красоты)
		phoneMasked.value = saved.phone.startsWith('+7')
			? `+7 (${saved.phone.slice(2, 5)}) ${saved.phone.slice(
					5,
					8
			  )}-${saved.phone.slice(8, 10)}-${saved.phone.slice(10, 12)}`
			: saved.phone

		authorized.value = true
		await loadOffersLinked()
	}
})

function normalizePhone(masked: string): string {
	const digits = masked.replace(/\D+/g, '')
	if (!digits) return ''
	if (digits.length === 11 && digits.startsWith('8'))
		return '+7' + digits.slice(1)
	if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
	if (!masked.startsWith('+')) return '+' + digits
	return '+' + digits
}
const phoneNormalized = computed(() => normalizePhone(phoneMasked.value))

async function submitPhone() {
	if (!phoneNormalized.value) {
		message.value = 'Введите номер телефона'
		return
	}

	// Если уже авторизованы и номер не менялся — просто обновим список
	const saved = loadAuth()
	if (authorized.value && saved?.phone === phoneNormalized.value) {
		await loadOffersByPhone()
		return
	}

	// Нужно initData от Telegram для первой связки
	if (!initData.value) {
		message.value = 'Откройте форму через Telegram: t.me/abclk_bot/cabinet'
		return
	}

	loading.value = true
	try {
		const res = await fetch(`${apiBase}/auth`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				phone: phoneNormalized.value,
				tg: tgUser
					? {
							id: tgUser.id,
							username: tgUser.username,
							first_name: tgUser.first_name,
							last_name: tgUser.last_name,
							language_code: tgUser.language_code,
					  }
					: null,
				initData: initData.value || '',
			}),
		})
		const data = await res.json().catch(() => ({}))

		if (res.ok && data?.contact_id) {
			authorized.value = true
			message.value = 'Готово! Ищу ваши сделки…'
			saveAuth({
				phone: data.phone || phoneNormalized.value,
				contact_id: data.contact_id,
				tg_id: tgUser?.id || null,
				ts: Date.now(),
			})
			await loadOffersLinked() // <-- вместо loadOffersByPhone()
			showToast('Вход выполнен')
		} else {
			message.value = data?.message || 'Ошибка авторизации'
		}
	} catch {
		message.value = 'Сеть недоступна. Попробуйте позже.'
	} finally {
		loading.value = false
	}
}

/** Список сделок */
const offers = ref<any[]>([])
const offersLoading = ref(false)

async function loadOffersByPhone() {
	offersLoading.value = true
	try {
		const res = await fetch(`${apiBase}/offers/by-phone`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ phone: phoneNormalized.value }),
		})
		const data = await res.json()
		offers.value = Array.isArray(data?.data) ? data.data : []
	} catch {
		// noop
	} finally {
		offersLoading.value = false
	}
}

/** Файлы сделки */
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
                const data = await res.json()
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

/** Отправка в чат */
const sendingFiles = ref(false)
const sendingOne = ref<Record<string, boolean>>({})

async function sendOneToChat(a: any) {
        const tg = (window as any).Telegram?.WebApp
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
        const tg = (window as any).Telegram?.WebApp
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

/** Выход */
function logout() {
	clearAuth()
	authorized.value = false
	selectedOffer.value = null
	attaches.value = []
	offers.value = []
	message.value = ''
	showToast('Вы вышли')
}
</script>

<style>
/* базовое */
body {
	font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell,
		Noto Sans, sans-serif;
	background: linear-gradient(90deg, #252b31 43%, #303941 100%);
	color: #fff;
}
a {
	color: #ffe664;
	text-decoration: none;
	transition: color 0.2s ease;
}
.wrap {
	max-width: 520px;
	margin: 32px auto;
	padding: 16px;
}
.topbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}
h1 {
	margin: 0;
}

/* форма/кнопки */
.box {
	display: grid;
	gap: 12px;
}
input {
	padding: 10px 12px;
	border: 1px solid #3a4450;
	border-radius: 10px;
	font-size: 16px;
	background: #1e242a;
	color: #fff;
}
button {
	padding: 10px 12px;
	border-radius: 10px;
	border: none;
	cursor: pointer;
	background: #ffe664;
	color: #303941;
	font-weight: 500;
	transition: background 0.2s ease, opacity 0.2s ease;
	font-size: 1.05em;
	display: inline-flex;
	align-items: center;
}
button:disabled {
	opacity: 0.7;
	cursor: default;
}
button.secondary {
	background: transparent;
	color: #ffe664;
	border: 1px solid #ffe664;
}
button.small {
	padding: 6px 10px;
	font-size: 0.95em;
}

.spinner {
	display: inline-block;
	width: 14px;
	height: 14px;
	border: 2px solid rgba(255, 255, 255, 0.6);
	border-top-color: #fff;
	border-radius: 50%;
	animation: spin 0.6s linear infinite;
	margin-right: 6px;
	vertical-align: middle;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

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
	border-radius: 6px;
	padding: 1px 6px;
	color: #303941;
	font-weight: 500;
}

/* список сделок */
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
	list-style-type: none;
	cursor: pointer;
}
.row {
	display: flex;
	justify-content: space-between;
	gap: 8px;
}
.row.sm {
	font-size: 12px;
	opacity: 0.9;
}

/* модалка */
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
	margin: 15px auto 0;
}

/* transition */
.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}

/* тост */
.toast {
	position: fixed;
	left: 50%;
	bottom: 16px;
	transform: translateX(-50%);
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	padding: 10px 14px;
	border-radius: 10px;
	font-size: 14px;
	border: 1px solid #3a4450;
	z-index: 60;
}
</style>
