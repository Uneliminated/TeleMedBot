const loginForm = document.getElementById('loginForm')
const errorMessage = document.getElementById('errorMessage')
const errorText = document.getElementById('errorText')
const loginButton = document.getElementById('loginButton')

//Обработка формы входа
document.addEventListener('DOMContentLoaded', function(e) {
    //Если мы на странице логина, настраиваем обработчик формы
    
    if (loginForm) {
        e.preventDefault()

        const usernameInput = document.getElementById('username')
        const passwordInput = document.getElementById('password')
        
        if (passwordInput) {
            passwordInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    loginForm.dispatchEvent(new Event('submit'))
                }
            })
        }
        
        if (usernameInput) {
            usernameInput.addEventListener('input', function(){
                errorMessage.style.display = 'none'
            })
        }
        if (passwordInput) {
            passwordInput.addEventListener('input', function(){
                errorMessage.style.display = 'none'
            })
        }

        loginForm.addEventListener('submit', function(e) {
            e.preventDefault()

            const username = usernameInput.value
            const password = passwordInput.value
            
            if (!username || !password) {
                showError('Пожалуйста, заполните все поля')
                return
            }
            
            loginButton.disabled = true
            loginButton.textContent = 'Вход...'

            fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            })
            .then(response => response.json()) 
            .then(data => {
                if (data.success) {
                    window.location.href = '/index.html'
                } else {
                    showError('Неверные данные')
                    resetLoginButton()
                }
            })
            .catch(error => {
                console.error('Ошибка входа:', error)
                showError('Ошибка сервера')
                resetLoginButton()
            })
        })
    }

    if (!window.location.pathname.includes('/login.html')) {
        checkAuth()
    }
})

function checkAuth() {
    //Проверяем аутентификацию
    fetch('/api/check-auth')
        .then(response => response.json())
        .then(data => {
            if (!data.authenticated) {
                window.location.href = '/login.html'
            }
        })
        .catch(error => {
            console.error('Ошибка проверки авторизации:', error)
            window.location.href = '/login.html'
        })
}

function showError(message) {
    errorText.textContent = message
    errorMessage.style.display = 'block'

    setTimeout(() => {
        errorMessage.style.display = 'none'
    }, 5000)
}

function resetLoginButton() {
    if (loginButton) {
        loginButton.disabled = false
        loginButton.textContent = 'Войти в систему'
    }
}

//Выход из системы
function logout() {
    fetch('/api/logout')
        .then(response => response.json())
        .then(() => {
            window.location.href = '/login.html'
        })
        .catch(error => {
            console.error('Ошибка выхода:', error)
            window.location.href = '/login.html'
        })
}

window.addEventListener('load', () => {
    const preloader = document.querySelector('.preloader')
    preloader.classList.add('hide')
})