// Функция для загрузки списка пользователей для выбора
async function loadUsersForExport() {
    try {
        const status = document.querySelector('input[name="statusFilter"]:checked').value;
        const url = `/api/users?page=1&limit=1000&status=${status}`;
        const response = await fetch(url);
        const data = await response.json();
        
        const container = document.getElementById('usersCheckboxList');
        const countSpan = document.getElementById('selectedUsersCount');
        
        if (data.users.length === 0) {
            container.innerHTML = '<div class="user_checkbox_item">Нет пользователей</div>';
            countSpan.textContent = '0 выбрано';
            return;
        }
        
        let html = '';
        data.users.forEach(user => {
            const statusClass = user.is_active ? 'active' : 'inactive';
            const statusText = user.is_active ? 'Активен' : 'Неактивен';
            html += `
                <label class="user_checkbox_item">
                    <input type="checkbox" class="user-checkbox" value="${user.id}" checked>
                    <span>${user.unique_name}</span>
                    <span class="user_status ${statusClass}">${statusText}</span>
                </label>
            `;
        });
        
        container.innerHTML = html;
        updateSelectedCount();
        
        // Добавляем обработчики для чекбоксов
        document.querySelectorAll('.user-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectedCount);
        });
        
        document.getElementById('selectAllUsers').addEventListener('change', function(e) {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
            updateSelectedCount();
        });
        
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
    }
}

// Обновление счетчика выбранных пользователей
function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.user-checkbox:checked');
    const count = checkboxes.length;
    document.getElementById('selectedUsersCount').textContent = `${count} выбрано`;
}

// Переключение видимости списка выбранных пользователей
function toggleUserSelection() {
    const selectedRadio = document.getElementById('exportSelectedUsers');
    const selectedUsersList = document.getElementById('selectedUsersList');
    
    if (selectedRadio.checked) {
        selectedUsersList.style.display = 'block';
        loadUsersForExport();
    } else {
        selectedUsersList.style.display = 'none';
    }
}

// Функция конвертации JSON в CSV
function convertToCSV(data) {
    const rows = [];
    
    // Заголовки
    rows.push([
        'Логин',
        'Статус',
        'Дата наблюдения',
        'Опрос пройден',
        'Итоговый балл',
        'Итоговый флаг',
        'Вопрос',
        'Ответ',
        'Баллы за вопрос'
    ].join(';'));
    
    // Данные
    data.users.forEach(user => {
        if (user.surveys && user.surveys.length > 0) {
            user.surveys.forEach(survey => {
                if (survey.answers && survey.answers.length > 0) {
                    // Есть детальные ответы
                    survey.answers.forEach(answer => {
                        rows.push([
                            `"${user.username}"`,
                            `"${user.status}"`,
                            `"${survey.date}"`,
                            survey.completed ? 'Да' : 'Нет',
                            survey.final_score || '',
                            survey.final_flag || '',
                            `"${answer.question.replace(/"/g, '""')}"`,
                            `"${answer.answer.replace(/"/g, '""')}"`,
                            answer.points || ''
                        ].join(';'));
                    });
                } else {
                    // Нет детальных ответов
                    rows.push([
                        `"${user.username}"`,
                        `"${user.status}"`,
                        `"${survey.date}"`,
                        survey.completed ? 'Да' : 'Нет',
                        survey.final_score || '',
                        survey.final_flag || '',
                        '',
                        '',
                        ''
                    ].join(';'));
                }
            });
        } else {
            // Нет опросов
            rows.push([
                `"${user.username}"`,
                `"${user.status}"`,
                '',
                '',
                '',
                '',
                '',
                '',
                ''
            ].join(';'));
        }
    });

    // Добавляем BOM для правильного отображения кириллицы в Excel
    return '\uFEFF' + rows.join('\n');
}

// Основная функция экспорта
async function exportData() {
    const exportButton = document.getElementById('exportButton');
    const progressDiv = document.getElementById('exportProgress');
    const progressFill = document.getElementById('exportProgressFill');
    const progressText = document.getElementById('exportProgressText');
    
    try {
        // Блокируем кнопку и показываем прогресс
        exportButton.disabled = true;
        progressDiv.style.display = 'block';
        progressFill.style.width = '10%';
        progressText.textContent = 'Подготовка запроса...';
        
        // Получаем выбранные опции
        const userSelection = document.querySelector('input[name="userSelection"]:checked').value;
        const statusFilter = document.querySelector('input[name="statusFilter"]:checked').value;
        const exportFormat = document.querySelector('input[name="exportFormat"]:checked').value;
        const includeEmptySurveys = document.getElementById('includeEmptySurveys').checked;
        const includeDetails = document.getElementById('includeSurveyDetails').checked;
        
        // Формируем параметры запроса
        let params = new URLSearchParams();
        params.append('includeEmptySurveys', includeEmptySurveys);
        params.append('includeDetails', includeDetails);
        params.append('status', statusFilter);
        
        // Если выбраны конкретные пользователи
        if (userSelection === 'selected') {
            const selectedUsers = Array.from(document.querySelectorAll('.user-checkbox:checked'))
                .map(cb => cb.value);
            
            if (selectedUsers.length === 0) {
                alert('Выберите хотя бы одного пользователя');
                throw new Error('Нет выбранных пользователей');
            }
            
            params.append('userIds', selectedUsers.join(','));
        }
        
        progressFill.style.width = '30%';
        progressText.textContent = 'Загрузка данных с сервера...';
        
        // Запрашиваем данные
        const response = await fetch(`/api/export/users?${params.toString()}`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Ошибка при загрузке данных');
        }
        
        progressFill.style.width = '80%';
        progressText.textContent = 'Подготовка файла...';
        
        // Подготавливаем файл для скачивания
        let fileContent;
        let fileName;
        let fileType;
        
        if (exportFormat === 'json') {
            fileContent = JSON.stringify(result.data, null, 2);
            fileName = `users_export_${new Date().toISOString().split('T')[0]}.json`;
            fileType = 'application/json';
        } else {
            fileContent = convertToCSV(result.data);
            fileName = `users_export_${new Date().toISOString().split('T')[0]}.csv`;
            fileType = 'text/csv;charset=utf-8;';
        }
        
        // Создаем и скачиваем файл
        const blob = new Blob([fileContent], { type: fileType });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        progressFill.style.width = '100%';
        progressText.textContent = 'Готово!';
        
        setTimeout(() => {
            progressDiv.style.display = 'none';
            exportButton.disabled = false;
        }, 2000);
        
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        alert('Ошибка при экспорте данных: ' + error.message);
        progressDiv.style.display = 'none';
        exportButton.disabled = false;
    }
}

// Добавляем обработчики событий при загрузке страницы
window.addEventListener('load', () => {
    // Добавляем обработчики для радио-кнопок выбора пользователей
    const userSelectionRadios = document.querySelectorAll('input[name="userSelection"]');
    userSelectionRadios.forEach(radio => {
        radio.addEventListener('change', toggleUserSelection);
    });
    
    // Обработчик изменения фильтра статуса
    const statusRadios = document.querySelectorAll('input[name="statusFilter"]');
    statusRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (document.getElementById('exportSelectedUsers').checked) {
                loadUsersForExport();
            }
        });
    });
    
    // Инициализация
    toggleUserSelection();
});