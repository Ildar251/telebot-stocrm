import { vMaska } from 'maska/vue' // <-- директива
import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)
app.directive('maska', vMaska)
app.mount('#app')
