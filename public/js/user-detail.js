let userId = null
let chart = null
let userRegistrationDate = null
let userEndDate = null
let isUserActive = false
let scrollPosition = 0;
let allQuestions = []
let selectedQuestions = []
let allSurveyDates = []
const QUESTION_ORDER = [
    "Как вы себя чувствуете?",
    "Есть ли у вас признаки ОРВИ?",
    "Одышка стала сильнее, чем вчера?",
    "Оцените одышку от 1 до 10",
    "Отеки стали сильнее, чем вчера?",
    "Оцените отеки от 1 до 10",
    "Слабость стала выраженнее, чем вчера?",
    "Оцените слабость от 1 до 10",
    "Какое у вас сегодня систолическое (верхнее) АД?",
    "Отмечаете ли Вы потемнение в глазах, головокружение?",
    "Теряете ли Вы сознание?",
    "Ощущаете ли Вы жжение, боль в груди?",
    "Появились ли у Вас внезапные нарушения движений, зрения или речи?",
    "Были ли у Вас судороги или потеря сознания?",
    "Чувствуете ли Вы боль в груди или одышку?",
    "Какой у вас сегодня пульс?"
]

//Получение ID пользователя из URL
function getUserIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('id')
}

//Форматирование даты в строку для отображения
function formateDateForDisplay(date) {
    const today = new Date()
    today.setHours(0,0,0,0)
    
    const compareDate = new Date(date)
    compareDate.setHours(0,0,0,0)

    if (compareDate.getTime() === today.getTime()) {
        return 'Сегодня'
    } else {
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        })
    }
}

//Форматирование даты для запроса к API (YYYY-MM-DD)
function formateDateForAPI(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

//Загрузка данных пользователя
async function loadUserData() {
    userId = getUserIdFromUrl()

    if (!userId) {
        const loadingElement = document.getElementById('loading')
        if (loadingElement) {
            loadingElement.innerHTML = `
                <div>
                    <p>ID пользователя не указан</p>
                    <a href="/index.html" class="btn">Вернуться к списку</a>
                </div>
            `
        }
        return
    }

    try {
        //Загружаем основную информацию о пользователе
        const response = await fetch(`/api/users/${userId}`)
        const data = await response.json()

        if (!data.user) {
            throw new Error('Пользователь не найден')
        }

        document.title = data.user.unique_name

        // Сохраняем дату регистрации пользователя
        if (data.user.registration_date) {
            userRegistrationDate = new Date(data.user.registration_date)
            userRegistrationDate.setHours(0,0,0,0)
        } else {
            userRegistrationDate = null
        }

        // Сохраняем даты окончания наблюдения и статус активности
        isUserActive = data.user.is_active || false
        if (data.user.observation_end_date_formatted) {
            const dateParts = data.user.observation_end_date_formatted.split('.')
            if (dateParts.length === 3) {
                userEndDate = new Date(
                    parseInt(dateParts[2]),
                    parseInt(dateParts[1]) - 1,
                    parseInt(dateParts[0])
                )
                userEndDate.setHours(0,0,0,0)
            }
        }

        renderUserInfo(data)
        renderStatistics(data.stats)
        loadQuestionsData()

        const loadingElement = document.getElementById('loading')
        const contentElement = document.getElementById('content')
        
        if (loadingElement) loadingElement.style.display = 'none'
        if (contentElement) contentElement.style.display = 'block'
    } catch (error) {
        console.error('Ошибка загрузки данных пользователя', error)
        const loadingElement = document.getElementById('loading')
        if (loadingElement) {
            loadingElement.innerHTML = `
                <div>
                    <p>Ошибка загрузки данных пользователя</p>
                    <p>${error.message}</p>
                    <a href="/index.html" class="btn">Вернуться к списку</a>
                </div>
            `
        }
    }
}

function renderUserInfo(data) {
    const user = data.user

    const userNameEl = document.getElementById('userName')
    const observationPeriodEl = document.getElementById('observationPeriod')
    const endDateEl = document.getElementById('endDate')
    const userStatusEl = document.getElementById('userStatus')
    const daysRemainingEl = document.getElementById('daysRemaining')

    if (userNameEl) userNameEl.textContent = user.unique_name || '-'
    if (observationPeriodEl) observationPeriodEl.textContent = user.observation_months ? `${user.observation_months} месяцев` : '-'
    if (endDateEl) endDateEl.textContent = user.observation_end_date_formatted || '-'

    if (userStatusEl) {
        if (user.is_active) {
            userStatusEl.innerHTML = `<span>Активен</span>`
        } else {
            userStatusEl.innerHTML = `<span>Завершен</span>`
        }
    }

    if (daysRemainingEl) {
        if (user.is_active) {
            daysRemainingEl.innerHTML = `<strong>${user.days_remaining || 0}</strong> дней`
        } else {
            daysRemainingEl.innerHTML = 'Завершено'
        }
    }
}

// Общая статистика
function renderStatistics(stats) {
    const totalSurveysEl = document.getElementById('totalSurveys')
    const avgScoreEl = document.getElementById('avgScore')
    const greenFlagsEl = document.getElementById('greenFlags')
    const yellowFlagsEl = document.getElementById('yellowFlags')
    const redFlagsEl = document.getElementById('redFlags')

    if (totalSurveysEl) totalSurveysEl.textContent = stats.total_surveys || 0
    if (avgScoreEl) avgScoreEl.textContent = stats.avg_score ? stats.avg_score.toFixed(1) : '0.0'
    if (greenFlagsEl) greenFlagsEl.textContent = stats.green_count || 0
    if (yellowFlagsEl) yellowFlagsEl.textContent = stats.yellow_count || 0
    if (redFlagsEl) redFlagsEl.textContent = stats.red_count || 0
}

// Функция для сортировки вопросов в заданном порядке
function sortQuestionsByOrder(questions) {
    // Создаем карту для быстрого доступа к индексу
    const orderMap = new Map()
    QUESTION_ORDER.forEach((question, index) => {
        orderMap.set(question, index)
    })
    
    // Сортируем вопросы согласно порядку из QUESTION_ORDER
    // Все вопросы гарантированно есть в списке
    return questions.sort((a, b) => {
        return orderMap.get(a) - orderMap.get(b)
    })
}

async function loadQuestionsData() {
    if (!userId) return
    
    try {
        // Получаем все уникальные вопросы из опросов пользователя
        const response = await fetch(`/api/users/${userId}/all-questions`)
        const data = await response.json()
        
        if (data.questions) {
            // Сортируем вопросы в заданном порядке
            allQuestions = sortQuestionsByOrder(data.questions)
            selectedQuestions = [...allQuestions]
            renderQuestionsPanel()
        }
        
        if (data.dates) {
            allSurveyDates = data.dates
        }
        
        // Если есть выбранные вопросы, обновляем таблицу
        if (selectedQuestions.length > 0) {
            await loadAnswersForQuestions()
        }
    } catch (error) {
        console.error('Ошибка загрузки вопросов:', error)
    }
}


function renderQuestionsPanel() {
    const graphsView = document.getElementById('graphsWrapper')
    if (!graphsView) return
    
    // Создаем HTML для панели вопросов
    let html = `
        <div class="questions-panel">
            <div class="questions-panel-header">
                <h3>Выберите вопросы для отображения:</h3>
                <div class="questions-panel-controls">
                    <button type="button" class="btn small-btn" onclick="selectAllQuestions()">Выбрать все</button>
                    <button type="button" class="btn small-btn" onclick="deselectAllQuestions()">Сбросить все</button>
                    <button type="button" class="btn primary-btn" onclick="updateQuestionsTable()">Применить</button>
                </div>
            </div>
            <div class="questions-list">
    `
    
    // Используем отсортированный allQuestions
    allQuestions.forEach((question, index) => {
        const isSelected = selectedQuestions.includes(question)
        const orderNumber = QUESTION_ORDER.indexOf(question) + 1
        
        html += `
            <div class="question-item">
                <label>
                    <input type="checkbox" 
                           class="question-checkbox" 
                           value="${question.replace(/"/g, '&quot;')}"
                           data-question-index="${index}"
                           ${isSelected ? 'checked' : ''}
                           onchange="handleQuestionCheckboxChange(this)">
                    <span class="question-text">
                        <span class="question-order">${orderNumber}.</span>
                        ${question}
                    </span>
                </label>
            </div>
        `
    })
    
    html += `
            </div>
        </div>
        <div class="questions-table-container" id="questionsTableContainer">
            <!-- Здесь будет таблица с ответами -->
        </div>
    `
    
    graphsView.innerHTML = html
}

// Обработчик изменений выбранных вопросов
function handleQuestionCheckboxChange(checkbox) {
    const question = checkbox.value

    if (checkbox.checked) {
        if (!selectedQuestions.includes(question)) {
            selectedQuestions.push(question)
        }
    } else {
        selectedQuestions = selectedQuestions.filter(q => q !== question)
    }
}

function selectAllQuestions() {
    selectedQuestions = [...allQuestions]
    const checkboxes = document.querySelectorAll('.question-checkbox')
    checkboxes.forEach(cb => cb.checked = true)
    updateQuestionsTable()
}

// Сбросить все вопросы
function deselectAllQuestions() {
    selectedQuestions = []
    const checkboxes = document.querySelectorAll('.question-checkbox')
    checkboxes.forEach(cb => cb.checked = false)
    updateQuestionsTable()
}

// Обновление таблицы с ответами
async function updateQuestionsTable() {
    if (selectedQuestions.length === 0) {
        document.getElementById('questionsTableContainer').innerHTML = `
            <div class="no-questions-selected">
                <p>Выберите вопросы для отображения</p>
            </div>
        `
        return
    }
    
    await loadAnswersForQuestions()
}

// Загрузка ответов для выбранных вопросов
async function loadAnswersForQuestions() {
    try {
        const container = document.getElementById('questionsTableContainer')
        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Загрузка ответов...</p>
            </div>
        `
        
        const response = await fetch(`/api/users/${userId}/answers-by-questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                questions: selectedQuestions,
                startDate: userRegistrationDate ? userRegistrationDate.toISOString().split('T')[0] : null,
                endDate: new Date().toISOString().split('T')[0]
            })
        })
        
        const data = await response.json()
        
        // Сортируем вопросы в ответе в заданном порядке
        if (data.answers) {
            const orderMap = new Map()
            QUESTION_ORDER.forEach((question, index) => {
                orderMap.set(question, index)
            })
            
            data.answers.sort((a, b) => {
                return orderMap.get(a.question) - orderMap.get(b.question)
            })
        }
        
        renderQuestionsTable(data)
    } catch (error) {
        console.error('Ошибка загрузки ответов:', error)
        document.getElementById('questionsTableContainer').innerHTML = `
            <div class="error-message">
                <p>Ошибка загрузки ответов: ${error.message}</p>
            </div>
        `
    }
}

// Отрисовка таблицы с ответами
function renderQuestionsTable(data) {
    const container = document.getElementById('questionsTableContainer')
    
    if (!data.answers || data.answers.length === 0) {
        container.innerHTML = `
            <div class="no-data-message">
                <p>Нет данных для отображения</p>
            </div>
        `
        return
    }
    
    // Получаем все уникальные даты и сортируем их
    const allDates = [...new Set(data.answers.map(item => item.date))].sort()
    
    // Группируем ответы по вопросам
    const answersByQuestion = {}
    selectedQuestions.forEach(question => {
        answersByQuestion[question] = {}
    })
    
    data.answers.forEach(item => {
        if (answersByQuestion[item.question]) {
            answersByQuestion[item.question][item.date] = {
                answer: item.answer,
                point: item.point,
                flag: item.flag
            }
        }
    })
    
    // Сортируем выбранные вопросы в заданном порядке
    const orderMap = new Map()
    QUESTION_ORDER.forEach((question, index) => {
        orderMap.set(question, index)
    })
    
    const sortedSelectedQuestions = [...selectedQuestions].sort((a, b) => {
        return orderMap.get(a) - orderMap.get(b)
    })
    
    // Создаем таблицу
    let html = `
        <div class="answers-table-wrapper">
            <table class="answers-table">
                <thead>
                    <tr>
                        <th class="question-column">
                            Вопрос 
                        </th>
    `
    
    // Заголовки с датами
    allDates.forEach(date => {
        const formattedDate = new Date(date).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        })
        html += `<th class="date-column">${formattedDate}</th>`
    })
    
    html += `
                    </tr>
                </thead>
                <tbody>
    `
    
    // Строки для каждого вопроса в отсортированном порядке
    sortedSelectedQuestions.forEach((question, index) => {
        const orderNumber = QUESTION_ORDER.indexOf(question) + 1
        
        html += `<tr>`
        
        // Колонка с вопросом и номером
        html += `<td class="question-column">
                    <span class="question-order">${orderNumber}.</span>
                    <strong>${question}</strong>
                </td>`
        
        // Ячейки с ответами по датам
        allDates.forEach(date => {
            const answerData = answersByQuestion[question][date]
            let cellClass = 'answer-cell'
            let answerText = '-'
            
            if (answerData) {
                answerText = answerData.answer || '-'
                // Добавляем класс флага для окраски ячейки
                if (answerData.flag) {
                    cellClass += ` flag-${answerData.flag}`
                }
                // Если есть баллы, отображаем их
                if (answerData.point !== undefined && answerData.point !== null) {
                    answerText += ` (${answerData.point})`
                }
            }
            
            html += `<td class="${cellClass}" title="${question} - ${answerText}">${answerText}</td>`
        })
        
        html += `</tr>`
    })
    
    html += `
                </tbody>
            </table>
        </div>
    `
    
    // Добавляем легенду
    html += `
        <div class="table-legend">
            <div class="legend-item">
                <span class="legend-color flag-green"></span>
                <span>Зеленый флаг</span>
            </div>
            <div class="legend-item">
                <span class="legend-color flag-yellow"></span>
                <span>Желтый флаг</span>
            </div>
            <div class="legend-item">
                <span class="legend-color flag-red"></span>
                <span>Красный флаг</span>
            </div>
        </div>
    `
    
    container.innerHTML = html
}

async function updatePeriod() {
    const monthsInput = document.getElementById('newMonths')
    if (!monthsInput) return

    const months = monthsInput.value

    if (!months || months < 1 || months > 60) {
        alert('Введите корректное количество месяцев (1-60)')
        return
    }

    try {
        const response = await fetch(`/api/users/${userId}/observation-period`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ months: parseInt(months) })
        })

        const result = await response.json()

        if (result.success) {
            alert(`Период наблюдения успешно обновлен на ${months} месяцев.\nНовая дата окончания: ${result.new_end_date_formatted}`)

            // Перезагружаем данные
            loadUserData()
        } else {
            alert('Ошибка: ' + (result.error || 'Неизвестная ошибка'))
        }
    } catch (error) {
        console.error('Ошибка обновления периода:', error)
        alert('Ошибка сети или сервера')
    }
}

//Вспомогательные функции
function getFlagText(flag) {
    switch(flag) {
        case 'red': return 'Красный';
        case 'yellow': return 'Желтый';
        case 'green': return 'Зеленый';
        default: return 'Неизвестно';
    }
}

// Ожидаем загрузку DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        loadUserData();
    });
} else {
    // DOM уже загружен
    loadUserData();
}

window.addEventListener('load', () => {
    const preloader = document.querySelector('.preloader')
    preloader.classList.add('hide')
})