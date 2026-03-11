let currentActiveSearch = ''
let currentFlag = 'all'
let currentInactiveSearch = ''
let searchTimeout = null

// Форматирование даты
function formateDateForDisplay(date) {
    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'numeric'
    })
}

// Загрузка статистики
async function loadStats() {
    try {
        const response = await fetch('/api/stats')
        const stats = await response.json()

        document.getElementById('totalUsers').textContent = stats.totalUsers || 0
        document.getElementById('activeUsers').textContent = stats.activeUsers || 0
        document.getElementById('todaySurveys').textContent = stats.completedSurveysToday || 0
        document.getElementById('redFlags').textContent = stats.redFlagsToday || 0
        document.getElementById('yellowFlags').textContent = stats.yellowFlagsToday || 0
        document.getElementById('greenFlags').textContent = stats.greenFLagsToday || 0
    } catch (error) {
        console.error('Ошибка загрузки статистики', error)
    }
}

// Загрузка всех активных пользователей
async function loadActiveUsers(page = 1) {
    try {
        let flagParam = currentFlag
        if (currentFlag === 'no-survey') {
            flagParam = 'no-survey'
        }
        
        const url = `/api/users?page=1&limit=1000&search=${encodeURIComponent(currentActiveSearch)}&status=active&flag=${flagParam}`
        const response = await fetch(url)
        const data = await response.json()
        renderActiveUsersTable(data.users)

    } catch (error) {
        console.error('Ошибка загрузки пациентов', error)
    }
}

// Загрузка неактивных пользователей
async function loadInactiveUsers(page = 1) {
    try {

        const url = `/api/users?page=1&limit=1000&search=${encodeURIComponent(currentInactiveSearch)}&status=inactive`
        const response = await fetch(url)
        const data = await response.json()

        renderInactiveUsersTable(data.users)

    } catch (error) {
        console.error('Ошибка загрузки пациентов', error)
    }
}

//Таблица активных пользователей
function renderActiveUsersTable(users) {
    const tbody = document.getElementById('usersActiveTable')

    for (let i = 1; i < 7; i++){
        const newDate = new Date()
        newDate.setDate(newDate.getDate() - i)
        const newDateFormatted = formateDateForDisplay(newDate)
        document.getElementById(`usersTableFlag${i}`).textContent = `${newDateFormatted}`
    }

    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11">
                    <i>Пользователи не найдены</i>
                </td>
            </tr>
        `
        return
    }



    tbody.innerHTML = users.map(user => {
        // Определяем класс для флага
        let flagClass = ''
        
        if (user.final_flag === 'red') flagClass = 'flag_red'
        else if (user.final_flag === 'yellow') flagClass = 'flag_yellow'
        else if (user.final_flag === 'green') flagClass = 'flag_green'
        else flagClass = 'flag_no_survey'

        // Создаем ячейки для флагов за 6 дней
        const flagCells = user.flags_history.map(flag => {
            let cellClass = '';
            if (flag === 'red') cellClass = 'flag_red';
            else if (flag === 'yellow') cellClass = 'flag_yellow';
            else if (flag === 'green') cellClass = 'flag_green';
            else cellClass = 'flag_no_survey';
            
            return `<td class="${cellClass}"></td>`;
        }).join('');
        
        return `
        <tr>
            <td>
                <a class="table_link" href="/user-detail.html?id=${user.id}" target="_blank">${user.unique_name}</a>
            </td>
            <td class="users_table_hide">${user.observation_end_date_formatted}</td>
            <td class="users_table_hide">${user.is_active ? `${user.days_remaining} дней` : `завершено`}</td>
            <td>${user.final_score}</td>
            <td class="${flagClass}"></td>
            ${flagCells}
        </tr>
        `
    }).join('')
}

//Таблица неактивных пользователей
function renderInactiveUsersTable(users) {
    const tbody = document.getElementById('usersInactiveTable')

    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3">
                    <i>Пользователи не найдены</i>
                </td>
            </tr>
        `
        return
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.unique_name}</td>
            <td>${user.observation_end_date_formatted}</td>
            <td>
                <button class="btn" onclick="viewUserDetails(${user.id})">
                    Подробно
                </button>
            </td>
        </td>
        `).join('')
}

function viewUserDetails(userId) {
    window.location.href = `/user-detail.html?id=${userId}`
}

// Функция поиска для активных пользователей
function handleActiveSearch() {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
        loadActiveUsers()
    }, 500)
}

// Функция поиска для неактивных пользователей
function handleInactiveSearch() {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
        currentInactivePage = 1 // Сброс на первую страницу при поиске
        loadInactiveUsers()
    }, 500)
}

window.addEventListener('load', () => {
    loadStats()
    loadActiveUsers()
    loadInactiveUsers()

    const preloader = document.querySelector('.preloader')
    preloader.classList.add('hide')

    const searchActiveInput = document.getElementById('usersActiveTableSearch')
    const statusActiveFlag = document.getElementById('flagFilter')
    const searchInactiveInput = document.getElementById('usersInactiveTableSearch')
    
    if (searchActiveInput) {
        searchActiveInput.addEventListener('input', function() {
            currentActiveSearch = searchActiveInput.value
            handleActiveSearch()
        })
    }
    
    if (statusActiveFlag) {
        statusActiveFlag.addEventListener('change', function() {
            currentFlag = statusActiveFlag.value
            currentActivePage = 1
            loadActiveUsers()
        })
    }

    if (searchInactiveInput) {
        searchInactiveInput.addEventListener('input', function() {
            currentInactiveSearch = searchInactiveInput.value
            handleInactiveSearch()
        })
    }

    setInterval(loadStats, 5 * 60 * 1000)
})

