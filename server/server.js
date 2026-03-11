import express from 'express';
import session from 'express-session';
import path from 'path';
import sqlite3 from 'better-sqlite3';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express()
const PORT = process.env.WEB_PORT || 3000

// Настройка сессий
app.use(session({
    secret: process.env.WEB_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Заменить на true при HTTPS
        maxAge: 24 * 60 * 60 * 1000
    }
}))

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, '../public')))

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite')
const db = new sqlite3(dbPath)

// Создаем таблицы, если они не существуют
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE NOT NULL,
        unique_name TEXT UNIQUE NOT NULL,
        observation_months INTEGER NOT NULL DEFAULT 1, -- Период наблюдения в месяцах
        created_at DATE DEFAULT (DATE('now')),
        observation_end_date DATE -- Дата окончания наблюдения
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS survey_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        question_order INTEGER NOT NULL,
        point INTEGER DEFAULT 0,
        answer_date DATE NOT NULL,
        created_at DATE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user_id, question_order, answer_date)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS survey_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        survey_date DATE NOT NULL,
        final_score INTEGER DEFAULT 0,
        final_flag TEXT NOT NULL, -- green, yellow, red
        created_at DATE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user_id, survey_date)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_survey_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, completed, skipped
        sent_at DATETIME,
        completed_at DATE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user_id, date)
    )
`).run();

// Middleware для аутентификации
const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) {
        next()
    } else {
        res.redirect('/login.html')
    }
}

// Маршруты

// 1. Авторизация
app.post('/api/login', (req, res) => {
    const { username, password } = req.body

    if (username === process.env.WEB_ADMIN_USERNAME && password === process.env.WEB_ADMIN_PASSWORD) {
        req.session.authenticated = true
        req.session.username = username
        res.json({ success: true })
    } else {
        res.status(401).json({ success: false, message: 'Неверные данные' })
    }
})

app.get('/api/logout', (req, res) => {
    req.session.destroy()
    res.json({ success: true })
})

app.get('/api/check-auth', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) })
})

// 2. Получение статистики
app.get('/api/stats', requireAuth, (req, res) => {
    const queries = {
        totalUsers: `SELECT COUNT(*) as count FROM users`,
        activeUsers: `SELECT COUNT(*) as count FROM users
                        WHERE observation_end_date IS NULL
                        OR observation_end_date > date('now')`,
        completedSurveysToday: `SELECT COUNT(DISTINCT user_id) as count
                                FROM survey_answers
                                WHERE DATE(created_at) = DATE('now')`,
        redFlagsToday: `SELECT COUNT(*) as count
                        FROM survey_results
                        WHERE survey_date = DATE('now')
                        AND final_flag = 'red'`,
        yellowFlagsToday: `SELECT COUNT(*) as count
                            FROM survey_results
                            WHERE survey_date = DATE('now')
                            AND final_flag = 'yellow'`,
        greenFLagsToday: `SELECT COUNT(*) as count
                            FROM survey_results
                            WHERE survey_date = DATE('now')
                            AND final_flag = 'green'`
    }

    try {
        const stats = {}

        Object.entries(queries).forEach(([key, query]) => {
            try {
                const row = db.prepare(query).get()
                stats[key] = row.count || 0
            } catch (err) {
                console.error(`Ошибка запроса ${key}:`, err)
                stats[key] = 0
            }
        })

        res.json(stats)
    } catch (err) {
        console.error('Ошибка получения статистики:', err)
        res.status(500).json({ error: 'Ошибка базы данных' })
    }
})

// 3. Получение списка пользователей
app.get('/api/users', requireAuth, (req,res) => {
    const { page = 1, limit = 20, search = '', status = 'all', flag = 'all' } = req.query
    const offset = (page - 1) * limit

    let whereClause = ''
    let params = []

    if (search) {
        whereClause += `WHERE (unique_name LIKE ? OR telegram_id LIKE ?) `
        params.push(`%${search}%`, `%${search}%`)
    }

    if (status === 'active') {
        whereClause += whereClause ? 'AND ' : 'WHERE '
        whereClause += `(u.observation_end_date IS NULL OR u.observation_end_date > date('now')) `
    } else if (status === 'inactive') {
        whereClause += whereClause ? 'AND ' : 'WHERE '
        whereClause += `u.observation_end_date <= date('now') `
    }

    // Создаем список последних 7 дней
    const dates = [];
    for (let i = 1; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(date.toISOString().split('T')[0]);
    }

    // Запрос для получения пользователей
    let query = `
        SELECT 
            u.id,
            u.telegram_id,
            u.unique_name,
            u.observation_months,
            u.created_at,
            u.observation_end_date,
            CASE
                WHEN u.observation_end_date IS NULL THEN 1
                WHEN u.observation_end_date > date('now') THEN 1
                ELSE 0
            END as is_active,
            julianday(u.observation_end_date) - julianday('now') as days_remaining,
            sr.final_score,
            sr.final_flag,
            sr.survey_date,
            -- Флаги за предыдущие 6 дней
            (SELECT final_flag FROM survey_results 
             WHERE user_id = u.id AND survey_date = '${dates[1]}') as flag_day1,
            (SELECT final_flag FROM survey_results 
             WHERE user_id = u.id AND survey_date = '${dates[2]}') as flag_day2,
            (SELECT final_flag FROM survey_results 
             WHERE user_id = u.id AND survey_date = '${dates[3]}') as flag_day3,
            (SELECT final_flag FROM survey_results 
             WHERE user_id = u.id AND survey_date = '${dates[4]}') as flag_day4,
            (SELECT final_flag FROM survey_results 
             WHERE user_id = u.id AND survey_date = '${dates[5]}') as flag_day5,
            (SELECT final_flag FROM survey_results 
             WHERE user_id = u.id AND survey_date = '${dates[6]}') as flag_day6
        FROM users u
        LEFT JOIN survey_results sr ON u.id = sr.user_id AND sr.survey_date = DATE('now')
        ${whereClause}
    `

    if (flag === 'red') {
        query += ` AND sr.final_flag = 'red' `
    } else if (flag === 'yellow') {
        query += ` AND sr.final_flag = 'yellow' `
    } else if (flag === 'green') {
        query += ` AND sr.final_flag = 'green' `
    } else if (flag === 'no-survey') {
        query += ` AND sr.id IS NULL `
    }

    query += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ? `

    // Запрос общего количества
    let countQuery = `
        SELECT COUNT(*) as total
        FROM users u
        LEFT JOIN survey_results sr ON u.id = sr.user_id AND sr.survey_date = DATE('now')
        ${whereClause}
    `
    if (flag === 'red') {
        countQuery += ` AND sr.final_flag = 'red' `
    } else if (flag === 'yellow') {
        countQuery += ` AND sr.final_flag = 'yellow' `
    } else if (flag === 'green') {
        countQuery += ` AND sr.final_flag = 'green' `
    } else if (flag === 'no-survey') {
        countQuery += ` AND sr.id IS NULL `
    }

    try {
        //Получаем общее количество
        const countParams = []
        if (search) {
            countParams.push(`%${search}%`, `%${search}%`)
        }
        const countRow = db.prepare(countQuery).get(...countParams)

        //Получаем пользователей
        const queryParams = []
        if (search) {
            queryParams.push(`%${search}%`, `%${search}%`)
        }
        queryParams.push(parseInt(limit), parseInt(offset))
        const rows = db.prepare(query).all(...queryParams)
        
        //Форматируем данные
        const users = rows.map(user => {
            // Определяем текст флага
            let flagText = user.final_flag
            if (!user.final_flag) {
                flagText = user.survey_date ? 'Нет данных' : 'Опрос не пройден'
            }

            // Создаем массив флагов за 6 дней
            const flags_history = [
                user.flag_day1 || 'none',
                user.flag_day2 || 'none',
                user.flag_day3 || 'none',
                user.flag_day4 || 'none',
                user.flag_day5 || 'none',
                user.flag_day6 || 'none'
            ];

            return {
                id: user.id,
                telegram_id: user.telegram_id,
                unique_name: user.unique_name,
                observation_months: user.observation_months,
                created_at: user.created_at,
                observation_end_date: user.observation_end_date,
                days_remaining: Math.max(0, Math.floor(user.days_remaining || 0)),
                is_active: user.is_active === 1,
                observation_end_date_formatted: user.observation_end_date ?
                    new Date(user.observation_end_date).toLocaleDateString('ru-RU') : 'Не указана',
                final_score: user.final_score || 'Нет',
                final_flag: flagText,
                flags_history: flags_history
            }
        })

        res.json({
            users,
            total: countRow.total,
            page: parseInt(page),
            totalPages: Math.ceil(countRow.total / limit)
        })
    } catch (err) {
        console.error('Ошибка получения пользователей:', err)
        res.status(500).json({ error: 'Ошибка базы данных' })
    }
})

// 4. Получение детальной информации о пользователе
app.get('/api/users/:id', requireAuth, (req, res) => {
    const userId = req.params.id

    try {
        //Запрос основной информации
        const userQuery = `
            SELECT u.*,
                CASE
                    WHEN observation_end_date IS NULL THEN 1
                    WHEN observation_end_date >= date('now') THEN 1
                    ELSE 0
                END as is_active,
                julianday(observation_end_date) - julianday('now') as days_remaining,
                date(created_at) as registration_date
            FROM users u
            WHERE u.id = ?
        `

        // Запрос статистики ответов
        const statsQuery = `
            SELECT
                COUNT(DISTINCT survey_date) as total_surveys,
                AVG(final_score) as avg_score,
                SUM(CASE WHEN final_flag = 'red' THEN 1 ELSE 0 END) as red_count,
                SUM(CASE WHEN final_flag = 'yellow' THEN 1 ELSE 0 END) as yellow_count,
                SUM(CASE WHEN final_flag = 'green' THEN 1 ELSE 0 END) as green_count
            FROM survey_results
            WHERE user_id = ?
        `

        //Получаем информацию о пользователе
        const user = db.prepare(userQuery).get(userId)
        if (!user) {
            res.status(404).json({ error: 'Пользователь не найден' })
            return
        }

        //Получаем статистику
        const stats = db.prepare(statsQuery).get(userId) || {
            total_survey: 0,
            avg_score: 0,
            red_count: 0,
            yellow_count: 0,
            green_count: 0
        }

        const result = {
            user: {
                ...user,
                days_remaining: Math.max(0, Math.floor(user.days_remaining || 0)),
                is_active: user.is_active === 1,
                created_at_formatted: new Date(user.create_at).toLocaleDateString('ru-RU'),
                observation_end_date_formatted: user.observation_end_date ?
                    new Date(user.observation_end_date).toLocaleDateString('ru-RU') : 'Не указана'
            },
            stats
        }

        res.json(result)
    } catch (err) {
        console.error('Ошибка получения детальной информации', err)
        res.status(500).json({ error: 'Ошибка базы данных' })
    }
})

// 5. Обновление периода наблюдения
app.put('/api/users/:id/observation-period', requireAuth, (req, res) => {
    const userId = req.params.id
    const { months } = req.body
    
    if (!months || months < 1 || months > 60) {
        return res.status(400).json({ error: 'Некорректный период (1-60 месяцев)' })
    }

    try {
        // Рассчитываем новую дату окончания
        const endDate = new Date()
        endDate.setMonth(endDate.getMonth() + parseInt(months))
        const endDateString = endDate.toISOString().split('T')[0]

        const query = `
            UPDATE users
            SET observation_months = ?, observation_end_date = ?
            WHERE id = ?
        `
        const stmt = db.prepare(query)
        const result = stmt.run(months, endDateString, userId)

        if (result.changes === 0) {
            res.status(404).json({ error: 'Пользователь не найдет' })
            return
        }
        
        res.json({
            success: true,
            new_end_date: endDateString,
            new_end_date_formatted: endDate.toLocaleDateString('ru-RU')
        })
    } catch (err) {
        console.error('Ошибка обновления периода:', err)
        res.status(500).json({ error: 'Ошибка обновления' })
    }
})

// 6. Экспорт данных пользователей
app.get('/api/export/users', requireAuth, async (req, res) => {
    try {
        const { userIds, status, includeEmptySurveys, includeDetails } = req.query;
        
        let userIdsArray = [];
        if (userIds) {
            userIdsArray = userIds.split(',').map(id => parseInt(id));
        }
        
        // Формируем WHERE условие
        let whereClause = '';
        let params = [];
        
        if (userIdsArray.length > 0) {
            whereClause = `WHERE u.id IN (${userIdsArray.map(() => '?').join(',')})`;
            params = [...userIdsArray];
        }
        
        if (status === 'active') {
            whereClause += whereClause ? ' AND ' : 'WHERE ';
            whereClause += `(u.observation_end_date IS NULL OR u.observation_end_date > date('now'))`;
        } else if (status === 'inactive') {
            whereClause += whereClause ? ' AND ' : 'WHERE ';
            whereClause += `u.observation_end_date <= date('now')`;
        }
        
        // Получаем пользователей
        const usersQuery = `
            SELECT 
                u.id,
                u.telegram_id,
                u.unique_name as username,
                u.observation_months,
                u.created_at as registration_date,
                u.observation_end_date,
                CASE
                    WHEN u.observation_end_date IS NULL THEN 1
                    WHEN u.observation_end_date > date('now') THEN 1
                    ELSE 0
                END as is_active,
                julianday(u.observation_end_date) - julianday(u.created_at) as total_days,
                COUNT(DISTINCT sr.survey_date) as completed_surveys
            FROM users u
            LEFT JOIN survey_results sr ON u.id = sr.user_id
            ${whereClause}
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `;
        
        const users = db.prepare(usersQuery).all(...params);
        
        if (users.length === 0) {
            return res.json({ users: [] });
        }
        
        // Получаем данные опросов для каждого пользователя
        const exportData = {
            generated_at: new Date().toISOString(),
            total_users: users.length,
            users: []
        };
        
        // Текущая дата для ограничения выгрузки
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        
        for (const user of users) {
            // Получаем все даты опросов пользователя (только до сегодняшнего дня)
            const surveyDatesQuery = `
                SELECT DISTINCT survey_date
                FROM survey_results
                WHERE user_id = ? AND survey_date <= ?
                ORDER BY survey_date DESC
            `;
            
            const surveyDates = db.prepare(surveyDatesQuery).all(user.id, todayStr);
            
            // Определяем период наблюдения (только до сегодняшнего дня)
            const startDate = new Date(user.registration_date);
            const endDate = user.observation_end_date ? 
                new Date(Math.min(new Date(user.observation_end_date).getTime(), today.getTime())) : 
                today;
            
            const surveys = [];
            
            // Если нужно включать дни без опросов
            if (includeEmptySurveys === 'true') {
                // Генерируем все даты периода наблюдения (только до сегодня)
                const currentDate = new Date(startDate);
                while (currentDate <= endDate) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    
                    // Проверяем, был ли опрос в этот день
                    const surveyOnDate = surveyDates.find(s => s.survey_date === dateStr);
                    
                    if (surveyOnDate) {
                        // Получаем результаты опроса за этот день
                        const surveyResult = db.prepare(`
                            SELECT 
                                final_score,
                                final_flag,
                                created_at
                            FROM survey_results
                            WHERE user_id = ? AND survey_date = ?
                        `).get(user.id, dateStr);
                        
                        const surveyData = {
                            date: dateStr,
                            completed: true,
                            final_score: surveyResult.final_score,
                            final_flag: surveyResult.final_flag,
                            completed_at: surveyResult.created_at
                        };
                        
                        // Если нужно включать детали опроса
                        if (includeDetails === 'true') {
                            const answers = db.prepare(`
                                SELECT 
                                    question,
                                    answer,
                                    point,
                                    question_order
                                FROM survey_answers
                                WHERE user_id = ? AND DATE(created_at) = ?
                                ORDER BY question_order
                            `).all(user.id, dateStr);
                            
                            surveyData.answers = answers.map(a => ({
                                question: a.question,
                                answer: a.answer,
                                points: a.point,
                                order: a.question_order
                            }));
                        }
                        
                        surveys.push(surveyData);
                    } else {
                        // Опрос не пройден в этот день
                        surveys.push({
                            date: dateStr,
                            completed: false,
                            final_score: null,
                            final_flag: null,
                            note: 'Опрос не пройден'
                        });
                    }
                    
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            } else {
                // Только дни с опросами (и только до сегодня)
                for (const date of surveyDates) {
                    if (date.survey_date <= todayStr) {
                        const surveyResult = db.prepare(`
                            SELECT 
                                final_score,
                                final_flag,
                                created_at
                            FROM survey_results
                            WHERE user_id = ? AND survey_date = ?
                        `).get(user.id, date.survey_date);
                        
                        const surveyData = {
                            date: date.survey_date,
                            completed: true,
                            final_score: surveyResult.final_score,
                            final_flag: surveyResult.final_flag,
                            completed_at: surveyResult.created_at
                        };
                        
                        if (includeDetails === 'true') {
                            const answers = db.prepare(`
                                SELECT 
                                    question,
                                    answer,
                                    point,
                                    question_order
                                FROM survey_answers
                                WHERE user_id = ? AND DATE(created_at) = ?
                                ORDER BY question_order
                            `).all(user.id, date.survey_date);
                            
                            surveyData.answers = answers.map(a => ({
                                question: a.question,
                                answer: a.answer,
                                points: a.point,
                                order: a.question_order
                            }));
                        }
                        
                        surveys.push(surveyData);
                    }
                }
            }
            
            // Сортируем опросы по дате (от новых к старым)
            surveys.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            exportData.users.push({
                id: user.id,
                username: user.username,
                telegram_id: user.telegram_id,
                status: user.is_active ? 'активен' : 'неактивен',
                registration_date: user.registration_date,
                observation_end_date: user.observation_end_date || 'не указана',
                total_observation_days: Math.floor(user.total_days || 0),
                completed_surveys_count: user.completed_surveys || 0,
                surveys: surveys
            });
        }
        
        // Возвращаем данные
        res.json({
            success: true,
            data: exportData
        });
        
    } catch (err) {
        console.error('Ошибка экспорта данных:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при экспорте данных' 
        });
    }
});

// 7. Получение всех вопросов пользователя
app.get('/api/users/:id/all-questions', requireAuth, (req, res) => {
    const userId = req.params.id
    
    try {
        // Получаем все уникальные вопросы из ответов пользователя
        const questionsQuery = `
            SELECT DISTINCT question
            FROM survey_answers
            WHERE user_id = ?
            ORDER BY question_order
        `
        
        const questions = db.prepare(questionsQuery).all(userId)
        
        // Получаем все даты опросов пользователя
        const datesQuery = `
            SELECT DISTINCT DATE(created_at) as date
            FROM survey_answers
            WHERE user_id = ?
            ORDER BY date ASC
        `
        
        const dates = db.prepare(datesQuery).all(userId)
        
        res.json({
            questions: questions.map(q => q.question),
            dates: dates.map(d => d.date)
        })
    } catch (err) {
        console.error('Ошибка получения вопросов:', err)
        res.status(500).json({ error: 'Ошибка базы данных' })
    }
})

// 8. Получение ответов по выбранным вопросам
app.post('/api/users/:id/answers-by-questions', requireAuth, (req, res) => {
    const userId = req.params.id
    const { questions, startDate, endDate } = req.body
    
    if (!questions || questions.length === 0) {
        return res.json({ answers: [] })
    }
    
    try {
        // Создаем плейсхолдеры для вопросов
        const placeholders = questions.map(() => '?').join(',')
        
        // Запрос для получения ответов на выбранные вопросы
        const query = `
            SELECT 
                sa.question,
                sa.answer,
                sa.point,
                DATE(sa.created_at) as date,
                sr.final_flag as flag
            FROM survey_answers sa
            LEFT JOIN survey_results sr ON sa.user_id = sr.user_id 
                AND DATE(sa.created_at) = sr.survey_date
            WHERE sa.user_id = ? 
                AND sa.question IN (${placeholders})
                ${startDate ? 'AND DATE(sa.created_at) >= ?' : ''}
                ${endDate ? 'AND DATE(sa.created_at) <= ?' : ''}
            ORDER BY sa.created_at ASC, sa.question_order ASC
        `
        
        const params = [userId, ...questions]
        
        if (startDate) params.push(startDate)
        if (endDate) params.push(endDate)
        
        const answers = db.prepare(query).all(...params)
        
        res.json({ answers })
    } catch (err) {
        console.error('Ошибка получения ответов:', err)
        res.status(500).json({ error: 'Ошибка базы данных' })
    }
})

// Защита статических файлов
app.get(['/index.html', '/user.html'], requireAuth, (req, res, next) => {
    next()
}, express.static(path.join(__dirname, '../public')))

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Веб-сервер запущен на порту ${PORT}`)
    console.log(`Адрес: http://localhost:${PORT}`)
})