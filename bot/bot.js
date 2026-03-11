import dotenv from 'dotenv';
import { Bot, Keyboard } from "grammy";
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { schedule } from 'node-cron';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production'

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite')

if (!fs.existsSync(dbPath)) {
    console.log('База данных не найдена, будет создана новая')
}

const db = new Database(dbPath, {
    verbose: console.log
})

db.pragma('foreign_keys = ON')

// Репозиторий для работы с пользователями
const userRepository = {
    getUserByTelegramId: (telegramId) => {
        const stmt = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
        return stmt.get(telegramId);
    },

    getUserById: (id) => {
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        return stmt.get(id);
    },

    getAllUsers: () => {
        const stmt = db.prepare('SELECT * FROM users');
        return stmt.all();
    },

    getActiveUsers: () => {
        const stmt = db.prepare(`
            SELECT * FROM users 
            WHERE observation_end_date IS NULL 
               OR observation_end_date > date('now')
        `);
        return stmt.all();
    },

    isUniqueName: (uniqueName) => {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE unique_name = ?');
        const result = stmt.get(uniqueName);
        return result.count === 0;
    },

    createUser: (telegramId, uniqueName, observationMonths) => {
        // Рассчитываем дату окончания наблюдения
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + observationMonths);
        const endDateString = endDate.toISOString();
        
        const stmt = db.prepare(`
            INSERT INTO users (telegram_id, unique_name, observation_months, observation_end_date) 
            VALUES (?, ?, ?, ?)
        `);
        const info = stmt.run(telegramId, uniqueName, observationMonths, endDateString);
        
        const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
        return getUserStmt.get(info.lastInsertRowid);
    },

    updateObservationPeriod: (userId, observationMonths) => {
        // Рассчитываем новую дату окончания наблюдения
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + observationMonths);
        const endDateString = endDate.toISOString();
        
        const stmt = db.prepare(`
            UPDATE users 
            SET observation_months = ?, observation_end_date = ? 
            WHERE id = ?
        `);
        stmt.run(observationMonths, endDateString, userId);
    },

    isObservationActive: (userId) => {
        const stmt = db.prepare(`
            SELECT 
                CASE 
                    WHEN observation_end_date IS NULL THEN 1
                    WHEN observation_end_date >= date('now') THEN 1
                    ELSE 0 
                END as is_active
            FROM users 
            WHERE id = ?
        `);
        const result = stmt.get(userId);
        return result?.is_active === 1;
    },

    getDaysRemaining: (userId) => {
        const stmt = db.prepare(`
            SELECT 
                julianday(observation_end_date) - julianday('now') as days_remaining
            FROM users 
            WHERE id = ?
        `);
        const result = stmt.get(userId);
        return Math.max(0, Math.floor(result?.days_remaining || 0));
    },

    getPoint: (question, answer) => {
        const zeroPoint = [
            "Хорошо/нормально",
            "100 - 139 мм рт.ст.",
            "51 - 109 уд/мин",
            "Нет"
        ]
        const onePoint = [
            "Плохо/не очень"
        ]
        const onePointQuestion = [
            "Есть ли у вас признаки ОРВИ?",
            "Одышка стала сильнее, чем вчера?",
            "Отеки стали сильнее, чем вчера?",
            "Слабость стала выраженнее, чем вчера?",
        ]
        const twoPoint = [
            "Ниже 50 уд/мин",
            "110 - 299 уд/мин",
            "Ниже 100 мм рт.ст.",
            "140 - 179 мм рт.ст.",
            "Выше 179 мм рт.ст."
        ]
        const twoPointQuestions = [
            "Отмечаете ли Вы потемнение в глазах, головокружение?"
        ]
        const fivePointQuestions = [
            "Теряете ли Вы сознание?",
            "Ощущаете ли Вы жжение, боль в груди?",
            "Появились ли у Вас внезапные нарушения движений, зрения или речи?",
            "Были ли у Вас судороги или потеря сознания?",
            "Чувствуете ли Вы боль в груди или одышку?"
        ];
        
        if (question === "Оцените одышку от 1 до 10") {
            if (answer === "1" || answer === "2" || answer === "3"){
                return 1;
            } else if (answer === "4" || answer === "5" || answer === "6") {
                return 2;
            } else {
                return 5;
            }
        } else if (question === "Оцените отеки от 1 до 10") {
            if (answer === "1" || answer === "2" || answer === "3"){
                return 1;
            } else if (answer === "4" || answer === "5" || answer === "6") {
                return 2;
            } else {
                return 3;
            }
        } else if (question === "Оцените слабость от 1 до 10"){
            if (answer === "1" || answer === "2" || answer === "3"){
                return 1;
            } else if (answer === "4" || answer === "5" || answer === "6" || answer === "7") {
                return 2;
            } else {
                return 3;
            }
        }
    

        if (zeroPoint.includes(answer)){
            return 0;
        } else if (onePoint.includes(answer)){
            return 1;
        } else if (twoPoint.includes(answer)){
            return 2;
        } else if (answer == 'Да'){
            if (onePointQuestion.includes(question)){
                return 1;
            } else if (twoPointQuestions.includes(question)){
                return 2;
            } else if (fivePointQuestions.includes(question)){
                return 5;
            }
        }
    },

    logDailySurvey: (userId, date, status) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO daily_survey_logs 
            (user_id, date, status, sent_at, completed_at) 
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const now = new Date().toISOString();
        if (status === 'sent') {
            stmt.run(userId, date, status, now, null);
        } else if (status === 'completed') {
            stmt.run(userId, date, status, null, now);
        } else {
            stmt.run(userId, date, status, null, null);
        }
    },

    getTodaysSurveyStatus: (userId) => {
        const today = new Date().toISOString().split('T')[0];
        const stmt = db.prepare('SELECT * FROM daily_survey_logs WHERE user_id = ? AND date = ?');
        return stmt.get(userId, today);
    },

    calculateFinalScore: (answers) => {
        const points = answers.map(answer => answer.point);
        const pointsSum = points.reduce((accumulator, currentValue) => {
            return accumulator + currentValue
        }, 0)
        return pointsSum
    },

    calculateFinalFlag: (answers) => {
        const points = answers.map(answer => answer.point);
        const pointsSum = points.reduce((accumulator, currentValue) => {
            return accumulator + currentValue
        }, 0)
        
        // Если больше 5 баллов - итоговый красный
        if (pointsSum > 5) {
            return 'red';
        }
        
        // Если меньше 5, но больше 1 балла - итоговый желтый
        if ((pointsSum > 1) && (pointsSum < 6)) {
            return 'yellow';
        }
        
        // В остальных случаях - зеленый
        return 'green';
    },

    saveSurveyResult: (userId, username, surveyDate, finalScore, finalFlag) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO survey_results 
            (user_id, username, survey_date, final_score, final_flag) 
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userId, username, surveyDate, finalScore, finalFlag);
    },

    getTodayQuestionsAndAnswers: (userId) => {
        const today = new Date().toISOString().split('T')[0];
        const stmt = db.prepare(`
            SELECT question, answer 
            FROM survey_answers 
            WHERE user_id = ? 
            AND DATE(answer_date) = ?
            ORDER BY question_order
        `);
        return stmt.all(userId, today);
    },
    
    getTodayAnswers: (userId) => {
        const today = new Date().toISOString().split('T')[0];
        const stmt = db.prepare(`
            SELECT answer, point 
            FROM survey_answers 
            WHERE user_id = ? 
            AND DATE(answer_date) = ?
            ORDER BY question_order
        `);
        return stmt.all(userId, today);
    },

    getSurveyResult: (userId, date) => {
        const stmt = db.prepare(`
            SELECT * FROM survey_results 
            WHERE user_id = ? AND survey_date = ?
        `);
        return stmt.get(userId, date);
    },

    getTodayAnswersCount: (userId) => {
        const today = new Date().toISOString().split('T')[0];
        const stmt = db.prepare(`
            SELECT COUNT(*) as count 
            FROM survey_answers 
            WHERE user_id = ? 
            AND DATE(created_at) = ?
        `)
        return stmt.get(userId, today).count
    },

    checkMissedSurveys: (userId) => {
        const today = new Date().toISOString().split('T')[0]

        // Получаем даты за последние 2 дня
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().split('T')[0]

        const dayBeforeYesterday = new Date()
        dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2)
        const dayBeforeYesterdayStr = dayBeforeYesterday.toISOString().split('T')[0]

        // Получаем статус опросов за вчера и позавчера
        const stmt = db.prepare(`
            SELECT date, status
            FROM daily_survey_logs
            WHERE user_id = ? AND date IN (?, ?)
        `)

        const logs = stmt.all(userId, yesterdayStr, dayBeforeYesterdayStr)
        
        const statusMap = {}
        logs.forEach(log => {
            statusMap[log.date] = log.status
        })

        // Проверяем, были ли заполнены опросники за вчера и позавчера
        const yesterdayCompleted = statusMap[yesterdayStr] === 'completed'
        const dayBeforeYesterdayCompleted = statusMap[dayBeforeYesterdayStr] === 'completed'

        // Проверяем, если уже запись о пропуске сегодня
        const todayMissedRecord = db.prepare(`
            SELECT * FROM survey_answers
            WHERE user_id = ? AND DATE(answer_date) = ? AND question = 'Пропуск опроса'  
        `).get(userId, today)

        return {
            yesterdayCompleted,
            dayBeforeYesterdayCompleted,
            bothMissed: !yesterdayCompleted && !dayBeforeYesterdayCompleted,
            hasTodayMissedRecord: !!todayMissedRecord
        }
    },

    createMissedSurveyRecord: (userId, username, date) => {
        // Создаем запись в survey_answers
        const answersStmt = db.prepare(`
            INSERT OR REPLACE INTO survey_answers
            (user_id, username, question, answer,  question_order, point, answer_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)    
        `)

        // Создаем один ответ для пропуска
        answersStmt.run(
            userId,
            username,
            'Пропуск опроса',
            'не заполнял опрос 3 или более дней подряд',
            1,
            6,
            date
        )

        // Создаем запись в survey_result
        const resultStmt = db.prepare(`
            INSERT OR REPLACE INTO survey_results
            (user_id, username, survey_date, final_score, final_flag)
            VALUES (?, ?, ?, ?, ?)    
        `)

        resultStmt.run(
            userId,
            username,
            date,
            6,
            'red'
        )

        // Обновляем daily_survey_logs
        const logStmt = db.prepare(`
            INSERT OR REPLACE INTO daily_survey_logs
            (user_id, date, status, completed_at)
            VALUES (?, ?, ?, ?)    
        `)

        logStmt.run(
            userId,
            date,
            'completed',
            new Date().toISOString()
        )

        console.log(`Создана запись о пропуске опросов более 2 дней для ${username} за ${date}`)
    },

    deleteTodayQuestionnare: (userId) => {
        const today = new Date().toISOString().split('T')[0];
    
        // Начинаем транзакцию для атомарного удаления всех связанных данных
        const deleteTransaction = db.transaction((userId, today) => {
            // Удаляем ответы на опрос за сегодня
            const deleteAnswersStmt = db.prepare(`
                DELETE FROM survey_answers 
                WHERE user_id = ? AND DATE(answer_date) = ?
            `);
            deleteAnswersStmt.run(userId, today);
            
            // Удаляем результат опроса за сегодня (если есть)
            const deleteResultStmt = db.prepare(`
                DELETE FROM survey_results 
                WHERE user_id = ? AND survey_date = ?
            `);
            deleteResultStmt.run(userId, today);
            
            // Обновляем статус на 'pending'
            const updateLogStmt = db.prepare(`
                UPDATE daily_survey_logs 
                SET status = 'pending', completed_at = NULL 
                WHERE user_id = ? AND date = ?
            `);
            updateLogStmt.run(userId, today);
            
            
            return;
        });
        
        // Выполняем транзакцию
        deleteTransaction(userId, today);
        
        console.log(`Удален опросник за ${today} для пользователя ${userId}.`)
        }
};

const bot = new Bot(process.env.BOT_TOKEN);

await bot.api.setMyCommands([
  { command: "start", description: "Начать работу" },
  { command: "survey", description: "Заполнить опросник вне расписания" },
  { command: "status", description: "Общая информация" },
]);

// Константы для вопросов и ответов
const QUESTIONS = [
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
];

const ANSWERS = [
    [
        "Хорошо/нормально",
        "Плохо/не очень",
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Нет",
        "Да"
    ],
    ["1","2","3","4","5","6","7","8","9","10"],
    [
        "Нет",
        "Да"
    ],
    ["1","2","3","4","5","6","7","8","9","10"],
    [
        "Нет",
        "Да"
    ],
    ["1","2","3","4","5","6","7","8","9","10"],
    [
        "Ниже 100 мм рт.ст.",
        "100 - 139 мм рт.ст.",
        "140 - 179 мм рт.ст.",
        "Выше 179 мм рт.ст."
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Нет",
        "Да"
    ],
    [
        "Ниже 50 уд/мин",
        "51 - 109 уд/мин",
        "110 - 299 уд/мин"
    ]
];

// Все возможные ответы для проверки
const ALL_ANSWERS = ANSWERS.flat();

// Простая система сессий в памяти
const sessions = new Map();

// Middleware для работы с сессиями
bot.use(async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
        return await next();
    }

    const sessionId = String(telegramId);
    
    // Если сессии нет, создаем новую
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            step: 'idle',
            currentQuestion: 0,
            nextQuestion: 1,
            uniqueName: null,
            userTelegramId: telegramId,
            observationMonths: null,
            lastActivity: Date.now()
        });
    }

    // Получаем сессию
    ctx.session = sessions.get(sessionId);
    
    // Обновляем время последней активности
    ctx.session.lastActivity = Date.now();
    
    try {
        await next();
    } catch (error) {
        console.error('Ошибка в middleware:', error);
        throw error;
    }
});

// Функция для установки сессии при автоматической отправке опроса
function setSessionForSurvey(telegramId, user) {
    const sessionId = String(telegramId);
    sessions.set(sessionId, {
        step: 'survey',
        currentQuestion: 0,
        nextQuestion: 1,
        uniqueName: user.unique_name,
        userTelegramId: telegramId,
        observationMonths: user.observation_months,
        lastActivity: Date.now()
    });
    console.log(`Сессия установлена для пользователя ${user.unique_name} (ID: ${telegramId})`);
}

// Функция для отправки опросника пользователю
async function sendSurveyToUser(user) {
    try {
        const telegramId = user.telegram_id;
        const today = new Date().toISOString().split('T')[0];
        
        // Проверяем, активен ли период наблюдения
        const isActive = userRepository.isObservationActive(user.id);
        if (!isActive) {
            const daysRemaining = userRepository.getDaysRemaining(user.id);
            console.log(`Период наблюдения завершен для пользователя ${user.unique_name}. Дней с окончания: ${Math.abs(daysRemaining)}`);
            
            // Отправляем уведомление об окончании периода наблюдения (только один раз)
            const endNotificationSent = sessions.get(`end_notification_${user.id}_${today}`);
            
            if (!endNotificationSent) {
                try {
                    await bot.api.sendMessage(
                        telegramId,
                        `Период вашего наблюдения завершен. Спасибо за участие! Для продолжения наблюдения обратитесь к администратору.`
                    );
                    sessions.set(`end_notification_${user.id}_${today}`, true);
                } catch (error) {
                    console.error(`Ошибка при отправке уведомления об окончании периода:`, error);
                }
            }
            return;
        }
        
        const daysRemaining = userRepository.getDaysRemaining(user.id);
        if (daysRemaining <= 3) {
            // Отправляем предупреждение об окончании периода (только один раз в день)
            const warningNotificationSent = sessions.get(`warning_${user.id}_${today}`);
            
            if (!warningNotificationSent) {
                try {
                    await bot.api.sendMessage(
                        telegramId,
                        `До окончания периода наблюдения осталось ${daysRemaining} ${getDaysWord(daysRemaining)}.`
                    );
                    sessions.set(`warning_${user.id}_${today}`, true);
                } catch (error) {
                    console.error(`Ошибка при отправке предупреждения:`, error);
                }
            }
        }

        // Проверяем пропуски за предыдущие дни
        const missedCheck = userRepository.checkMissedSurveys(user.id)

        // Если пропущено 2 дня подряд, создаем запись
        if (missedCheck.bothMissed && !missedCheck.hasTodayMissedRecord) {
            userRepository.createMissedSurveyRecord(user.id, user.unique_name, today)

            // Отправялем уведомление о пропусках
            try {
                await bot.api.sendMessage(
                    telegramId,
                    `Внимание! Вы пропустили 2 дня подряд. Не забудьте пройти сегодняшний опрос.`
                )
            } catch (error) {
                console.error(`Ошибка при отправке уведомления о пропусках:`, error)
            }
        }
        
        // Проверяем, был ли сегодня уже отправлен опрос
        const todayRealAnswers = db.prepare(`
            SELECT COUNT(*) as count 
            FROM survey_answers 
            WHERE user_id = ? AND DATE(answer_date) = ? AND question != 'Пропуск опроса'
        `).get(user.id, today).count;
        
        // Если есть реальные ответы, не отправляем опрос
        if (todayRealAnswers > 0) {
            console.log(`Пользователь ${user.unique_name} уже заполнил реальный опрос сегодня`);
            return;
        }

        // Логируем отправку опроса
        userRepository.logDailySurvey(user.id, today, 'sent');

        // Устанавливаем сессию для пользователя
        setSessionForSurvey(telegramId, user);

        const buttonRows = ANSWERS[0].map((label) => [Keyboard.text(label)]);
        const keyboard = Keyboard.from(buttonRows).resized();

        await bot.api.sendMessage(
            telegramId, 
            `Ежедневный опрос (До окончания наблюдения: ${daysRemaining} ${getDaysWord(daysRemaining)})\n\n${QUESTIONS[0]}`,
            { reply_markup: keyboard }
        );

        console.log(`Опрос отправлен пользователю ${user.unique_name} (ID: ${user.telegram_id}), дней осталось: ${daysRemaining}`);
        
    } catch (error) {
        console.error(`Ошибка при отправке опроса пользователю ${user.unique_name}:`, error);
        
        if (error.description?.includes('blocked') || error.error_code === 403) {
            console.log(`Пользователь ${user.unique_name} заблокировал бота`);
        }
    }
}

// Вспомогательная функция для правильного склонения слова "день"
function getDaysWord(days) {
    if (days % 10 === 1 && days % 100 !== 11) {
        return 'день';
    } else if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) {
        return 'дня';
    } else {
        return 'дней';
    }
}

// Функция для отправки опросника всем активным пользователям
async function sendDailySurveyToAllUsers() {
    console.log('Начинаю отправку ежедневных опросов...');
    
    try {
        const users = userRepository.getActiveUsers();
        console.log(`Найдено ${users.length} активных пользователей`);

        for (const user of users) {
            const isQuestionnaire = userRepository.getTodayAnswersCount(user.id)
            if (isQuestionnaire === 0) {
                await sendSurveyToUser(user);
                // Задержка между отправками
                await new Promise(resolve => setTimeout(resolve, 50));
            } else {
                continue
            }
        }

        console.log('Ежедневные опросы отправлены активным пользователям');
    } catch (error) {
        console.error('Ошибка при отправке ежедневных опросов:', error);
    }
}

// Настраиваем cron-задачу для ежедневной отправки в 12:00
schedule('0 12 * * *', async () => {
    console.log('Запуск автоматической отправки опросов (12:00)...');
    await sendDailySurveyToAllUsers();
}, {
    timezone: "Europe/Moscow"
});

// Команда /start
bot.command('start', async (ctx) => {
    const telegramId = ctx.from.id;

    try {
        const existingUser = userRepository.getUserByTelegramId(telegramId);
        if (existingUser) {
            const isActive = userRepository.isObservationActive(existingUser.id);
            const daysRemaining = userRepository.getDaysRemaining(existingUser.id);
            
            if (isActive) {
                await ctx.reply(
                    `Вы уже зарегистрированы. Период наблюдения: ${existingUser.observation_months} месяцев.\n` +
                    `До окончания: ${daysRemaining} ${getDaysWord(daysRemaining)}.\n` +
                    `Используйте /survey для начала опроса.`
                );
            } else {
                await ctx.reply(
                    `Ваш период наблюдения завершен. Для продолжения обратитесь к администратору.`
                );
            }
            return;
        }

        ctx.session.step = 'login';
        await ctx.reply("Вас приветствует ТелеМедБот. Введите Логин");
    } catch (error) {
        console.error('Ошибка при проверке пользователя', error);
        await ctx.reply('Ошибка, попробуйте позже');
    }
});

// Команда опроса (ручной запуск)
bot.command('survey', async (ctx) => {
    const telegramId = ctx.from.id;

    try {
        const user = userRepository.getUserByTelegramId(telegramId);

        if (!user) {
            await ctx.reply('Сначала зарегистрируйтесь с помощью команды /start');
            return;
        }
        
        // Проверяем, активен ли период наблюдения
        const isActive = userRepository.isObservationActive(user.id);
        if (!isActive) {
            const daysRemaining = userRepository.getDaysRemaining(user.id);
            await ctx.reply(`Период вашего наблюдения завершен ${Math.abs(daysRemaining)} ${getDaysWord(Math.abs(daysRemaining))} назад. Для продолжения обратитесь к администратору.`);
            return;
        }

        // Удаляем существующий опросник, если он есть
        const isQuestionnaire = userRepository.getTodayAnswersCount(user.id)
        if (isQuestionnaire > 0) {
            userRepository.deleteTodayQuestionnare(user.id)
        }
        
        // Также удаляем запись о пропуске за сегодня, если она есть
        const deleteMissedStmt = db.prepare(`
            DELETE FROM survey_answers 
            WHERE user_id = ? AND DATE(answer_date) = ? AND question = 'Пропуск опроса'
        `);
        deleteMissedStmt.run(user.id, new Date().toISOString().split('T')[0]);
        
        const deleteMissedResultStmt = db.prepare(`
            DELETE FROM survey_results 
            WHERE user_id = ? AND survey_date = ? AND final_score = 6
        `);
        deleteMissedResultStmt.run(user.id, new Date().toISOString().split('T')[0]);

        // Устанавливаем сессию
        ctx.session.step = 'survey';
        ctx.session.currentQuestion = 0;
        ctx.session.nextQuestion = 1,
        ctx.session.uniqueName = user.unique_name;
        ctx.session.userTelegramId = telegramId;

        const daysRemaining = userRepository.getDaysRemaining(user.id);
        const buttonRows = ANSWERS[0].map((label) => [Keyboard.text(label)]);
        const keyboard = Keyboard.from(buttonRows).resized();

        await ctx.reply(
            `Ежедневный опрос (До окончания наблюдения: ${daysRemaining} ${getDaysWord(daysRemaining)})\n\n${QUESTIONS[0]}`,
            { reply_markup: keyboard }
        );
    } catch (error) {
        console.error('Ошибка при запуске опроса', error);
        await ctx.reply('Произошла ошибка');
    }
});

// Функция обработки ответа на опрос
async function handleSurveyAnswer(ctx, answer) {
    const telegramId = ctx.from.id;
    const user = userRepository.getUserByTelegramId(telegramId);
    const today = new Date().toISOString().split('T')[0];

    
    if (!user) {
        await ctx.reply('Пользователь не найден. Зарегистрируйтесь с помощью /start');
        ctx.session.step = 'idle';
        return;
    }

    const currentQuestion = ctx.session.currentQuestion;
    const nextQuestion = ctx.session.nextQuestion;
    
    // Проверяем, является ли ответ допустимым для текущего вопроса
    if (!ANSWERS[currentQuestion].includes(answer)) {
        await ctx.reply('Пожалуйста, выберите ответ из предложенных вариантов');
        return;
    }

    // Сохраняем ответ в базу данных
    const point = userRepository.getPoint(QUESTIONS[currentQuestion], answer);
    
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO survey_answers (user_id, username, question, answer, question_order, point, answer_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
        user.id,
        user.unique_name,
        QUESTIONS[currentQuestion],
        answer,
        currentQuestion + 1,
        point,
        today
    );

    console.log(`Пользователь ${user.unique_name} ответил на вопрос ${currentQuestion + 1}: ${answer}`);

    if (currentQuestion < QUESTIONS.length - 1) {
        // Переходим к следующему вопросу
        ctx.session.currentQuestion = nextQuestion;
        
        const buttonRows = ANSWERS[nextQuestion].map((label) => [Keyboard.text(label)]);
        const keyboard = Keyboard.from(buttonRows).resized();
        await ctx.reply(`${QUESTIONS[nextQuestion]}`, { reply_markup: keyboard });
    } else {
        // Проверка правильности ответов пациента
        ctx.session.step = 'check'
        await checkAnswers(ctx, user);
    }
}

// Вывод полученных ответов на вопросы
async function checkAnswers(ctx, user) {
    let text = `Нажмите <b>"Все верно"</b>, если все ответы выбраны верно\n\nНажмите <b>"Заполнить заново"</b>, если необходимо изменить ответы:\n\n`
    try {
        const todayQuestionsAndAnswers = userRepository.getTodayQuestionsAndAnswers(user.id);
        const questions = todayQuestionsAndAnswers.map(questionsAndAnswers => questionsAndAnswers.question)
        const answers = todayQuestionsAndAnswers.map(questionsAndAnswers => questionsAndAnswers.answer)
        for (let i = 0; i < questions.length; i++) {
            text += `Вопрос №${i+1}. ${questions[i]}\nОтвет:${answers[i]}\n\n`
        }
        const checkKeyboard = [
            "Все верно",
            "Заполнить заново"
        ]
        const buttonRows = checkKeyboard.map((label) => [Keyboard.text(label)]);
        const keyboard = Keyboard.from(buttonRows).resized();
        console.log(text)
        await ctx.reply(text, { 
            parse_mode: "HTML",
            reply_markup: keyboard 
        })
    } catch (error) {
        console.error('Ошибка при завершении опроса:', error);
        await ctx.reply('Ошибка при завершении опроса');
    }
}

// Завершение опроса
async function completeSurvey(ctx, user) {
    
    try {
        const today = new Date().toISOString().split('T')[0]

        // Удаляем запись о пропуске за сегодня (если есть)
        const deleteMissedStmt = db.prepare(`
            DELETE FROM survey_answers
            WHERE user_id = ? AND DATE(answer_date) = ? AND question = 'Пропуск опроса'    
        `)
        deleteMissedStmt.run(user.id, today)

        const deleteMissedResultStmt = db.prepare(`
            DELETE FROM survey_results
            WHERE user_id = ? AND survey_date = ? AND final_score = 6    
        `)
        deleteMissedResultStmt.run(user.id, today)

        // Получаем все ответы за сегодня
        const todayAnswers = userRepository.getTodayAnswers(user.id);
        
        // Расчитываем итоговую сумму баллов
        const finalScore = userRepository.calculateFinalScore(todayAnswers);

        // Рассчитываем итоговый флаг
        const finalFlag = userRepository.calculateFinalFlag(todayAnswers);
        
        // Сохраняем результат опроса
        userRepository.saveSurveyResult(user.id, user.unique_name, today, finalScore, finalFlag);
        
        // Логируем завершение опроса
        userRepository.logDailySurvey(user.id, today, 'completed');
        
        if (finalFlag === 'red') {
            await ctx.reply(
                `Данные показатели являются <b>опасными</b>, поэтому рекомендуем Вам вызвать СМП.\nНаш чат-бот не оказывает экстренную помощь.\nВаши данные позже будут проанализированы врачом.\n`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        remove_keyboard: true
                    }
                }
            )
        } else {
            await ctx.reply(
                `Опрос завершен! Спасибо за ответы.\n`,
                {
                    reply_markup: {
                        remove_keyboard: true
                    }
                }
            );
        }
        
        console.log(`Пользователь ${user.unique_name} завершил опрос`);

        // Сбрасываем сессию
        ctx.session.step = 'idle';
        ctx.session.currentQuestion = 0;
        ctx.session.uniqueName = null;
    } catch (error) {
        console.error('Ошибка при завершении опроса:', error);
        await ctx.reply('Ошибка при завершении опроса');
    }
}

// Команда для просмотра статуса наблюдения
bot.command('status', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = userRepository.getUserByTelegramId(telegramId);

    if (!user) {
        await ctx.reply('Сначала зарегистрируйтесь с помощью команды /start');
        return;
    }

    const isActive = userRepository.isObservationActive(user.id);
    const daysRemaining = userRepository.getDaysRemaining(user.id);
    const endDate = new Date(user.observation_end_date);
    const formattedDate = endDate.toLocaleDateString('ru-RU');

    let statusMessage = `Статус вашего наблюдения:\n`;
    statusMessage += `Имя: ${user.unique_name}\n`;
    statusMessage += `Период: ${user.observation_months} месяцев\n`;
    statusMessage += `Дата окончания: ${formattedDate}\n`;
    statusMessage += `Статус: ${isActive ? 'Активно' : 'Завершено'}\n`;

    if (isActive) {
        statusMessage += `Дней осталось: ${daysRemaining}`;
    } else {
        statusMessage += `Дней с окончания: ${Math.abs(daysRemaining)}`;
    }

    await ctx.reply(statusMessage);
});

// Команда для отладки
bot.command('debug', async (ctx) => {
    const sessionInfo = {
        ...ctx.session,
        // Убираем большие поля для удобства чтения
        lastActivity: ctx.session.lastActivity ? new Date(ctx.session.lastActivity).toISOString() : null
    };
    
    await ctx.reply(`Текущая сессия:\n\`\`\`json\n${JSON.stringify(sessionInfo, null, 2)}\n\`\`\``, {
        parse_mode: 'Markdown'
    });
    
    const user = userRepository.getUserByTelegramId(ctx.from.id);
    if (user) {
        const todayStatus = userRepository.getTodaysSurveyStatus(user.id);
        const isActive = userRepository.isObservationActive(user.id);
        const daysRemaining = userRepository.getDaysRemaining(user.id);
        
        await ctx.reply(
            `Пользователь: ${user.unique_name}\n` +
            `Статус опроса сегодня: ${todayStatus ? todayStatus.status : 'нет данных'}\n` +
            `Период наблюдения: ${user.observation_months} месяцев\n` +
            `Статус наблюдения: ${isActive ? 'Активно' : 'Завершено'}\n` +
            `Дней осталось/прошло: ${daysRemaining}`
        );
    }
});

// Команда для сброса сессии
bot.command('reset_session', async (ctx) => {
    const sessionId = String(ctx.from.id);
    sessions.delete(sessionId);
    
    // Создаем новую сессию
    sessions.set(sessionId, {
        step: 'idle',
        currentQuestion: 0,
        uniqueName: null,
        userTelegramId: ctx.from.id,
        observationMonths: null,
        lastActivity: Date.now()
    });
    
    ctx.session = sessions.get(sessionId);
    await ctx.reply('Сессия сброшена');
});

// Админская команда для продления периода наблюдения
bot.command('extend_observation', async (ctx) => {
    // Проверяем, является ли пользователь администратором
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (ctx.from.id.toString() !== adminId) {
        await ctx.reply('У вас нет прав для выполнения этой команды');
        return;
    }

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
        await ctx.reply('Использование: /extend_observation [username] [months]\nПример: /extend_observation user123 3');
        return;
    }

    const username = args[0];
    const months = parseInt(args[1]);

    if (isNaN(months) || months < 1 || months > 60) {
        await ctx.reply('Пожалуйста, введите корректное число месяцев (от 1 до 60)');
        return;
    }

    try {
        const stmt = db.prepare('SELECT * FROM users WHERE unique_name = ?');
        const user = stmt.get(username);

        if (!user) {
            await ctx.reply(`Пользователь ${username} не найден`);
            return;
        }

        userRepository.updateObservationPeriod(user.id, months);
        const newDaysRemaining = userRepository.getDaysRemaining(user.id);
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + months);

        await ctx.reply(
            `Период наблюдения для пользователя ${username} продлен на ${months} месяцев.\n` +
            `Новая дата окончания: ${endDate.toLocaleDateString('ru-RU')}\n` +
            `Дней осталось: ${newDaysRemaining}`
        );

        // Отправляем уведомление пользователю
        try {
            await bot.api.sendMessage(
                user.telegram_id,
                `Ваш период наблюдения продлен на ${months} месяцев. Новый период завершится ${endDate.toLocaleDateString('ru-RU')}.\n` +
                `Продолжайте ежедневно заполнять опросы.`
            );
        } catch (error) {
            console.error(`Ошибка при отправке уведомления пользователю:`, error);
        }
    } catch (error) {
        console.error('Ошибка при продлении периода наблюдения:', error);
        await ctx.reply('Произошла ошибка при продлении периода');
    }
});

// Команда для просмотра всех сессий (только для отладки)
bot.command('sessions', async (ctx) => {
    let message = `Всего сессий: ${sessions.size}\n\n`;
    for (const [key, session] of sessions.entries()) {
        message += `ID: ${key}, шаг: ${session.step}, вопрос: ${session.currentQuestion}, имя: ${session.uniqueName}\n`;
    }
    await ctx.reply(message);
});

// Команда для ручного запуска отправки опросов
bot.command('send_surveys', async (ctx) => {
    await ctx.reply('Начинаю отправку опросов всем активным пользователям...');
    await sendDailySurveyToAllUsers();
    await ctx.reply('Опросы отправлены!');
});

// Команда для просмотра статистики
bot.command('stats', async (ctx) => {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (ctx.from.id.toString() !== adminId) {
        await ctx.reply('У вас нет прав для выполнения этой команды');
        return;
    }

    try {
        const allUsers = userRepository.getAllUsers();
        const activeUsers = userRepository.getActiveUsers();
        const inactiveUsers = allUsers.filter(user => !userRepository.isObservationActive(user.id));
        
        let statsMessage = `📊 Статистика наблюдения:\n\n`;
        statsMessage += `Всего пользователей: ${allUsers.length}\n`;
        statsMessage += `Активных пользователей: ${activeUsers.length}\n`;
        statsMessage += `Завершивших наблюдение: ${inactiveUsers.length}\n\n`;
        
        if (activeUsers.length > 0) {
            statsMessage += `Активные пользователи:\n`;
            activeUsers.forEach(user => {
                const daysRemaining = userRepository.getDaysRemaining(user.id);
                const endDate = new Date(user.observation_end_date);
                statsMessage += `• ${user.unique_name}: ${daysRemaining} дней до ${endDate.toLocaleDateString('ru-RU')}\n`;
            });
        }

        await ctx.reply(statsMessage);
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        await ctx.reply('Произошла ошибка при получении статистики');
    }
});

// Обработка всех текстовых сообщений
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const telegramId = ctx.from.id;
    const user = userRepository.getUserByTelegramId(telegramId);
    const step = ctx.session.step;
    const currentQuestion = ctx.session.currentQuestion;

    console.log(`Получено сообщение от ${telegramId}: "${text}", шаг: ${step}, вопрос: ${ctx.session.currentQuestion}`);

    // Если пользователь находится в процессе опроса - обрабатываем ответ
    if (step === 'survey') {
        if (text === "Хорошо/нормально"){
            ctx.session.nextQuestion = 2
        } else if ((currentQuestion === 2) && (text === "Нет")){
            ctx.session.nextQuestion = 4
        } else if ((currentQuestion === 4) && (text === "Нет")){
            ctx.session.nextQuestion = 6
        } else if ((currentQuestion === 6) && (text === "Нет")){
            ctx.session.nextQuestion = 8
        } else if ((text === "100 - 139 мм рт.ст.") || (text === "140 - 179 мм рт.ст.")){
            ctx.session.nextQuestion = 15
        } else if (text === "Выше 179 мм рт.ст."){
            ctx.session.nextQuestion = 12
        } else if (currentQuestion === 11){
            ctx.session.nextQuestion = 15
        } else {
            ctx.session.nextQuestion = currentQuestion + 1;
        }
        
        await handleSurveyAnswer(ctx, text);
        return;
    }

    // Проверяем, не является ли сообщение одним из возможных ответов на опрос
    if (ALL_ANSWERS.includes(text) && !['survey', 'changeAnswer'].includes(step)) {
        // Если пользователь отправил ответ на опрос, но у него нет активной сессии,
        // возможно сессия потерялась. Проверяем пользователя и предлагаем начать заново
        const user = userRepository.getUserByTelegramId(telegramId);
        if (user) {
            await ctx.reply('У вас нет активного опроса. Используйте команду /survey чтобы начать опрос.');
            return;
        }
    }

    // Обработка других шагов (регистрация)
    if (step === 'login') {
        if (text === process.env.LOGIN) {
            ctx.session.step = 'password';
            await ctx.reply('Введите пароль');
        } else {
            await ctx.reply('Неверный логин');
        }
    } else if (step === 'password') {
        if (text === process.env.PASSWORD) {
            ctx.session.step = 'unique_name';
            await ctx.reply('Придумайте уникальное имя (только латинские буквы и цифры):');
        } else {
            await ctx.reply('Неверный пароль. Повторите попытку');
            ctx.session.step = 'idle';
        }
    } else if (step === 'unique_name') {
        // Проверяем формат имени
        if (!/^[a-zA-Z0-9_]+$/.test(text)) {
            await ctx.reply('Имя должно содержать только латинские буквы, цифры и знак подчеркивания. Придумайте другое имя:');
            return;
        }
        
        try {
            const isUnique = userRepository.isUniqueName(text);
            if (!isUnique) {
                await ctx.reply('Имя занято, придумайте другое:');
                return;
            }

            ctx.session.step = 'observation_period';
            ctx.session.uniqueName = text;
            
            await ctx.reply(
                'На какой срок устанавливается наблюдение? Выберите количество месяцев:\n' +
                '1 - 1 месяц\n' +
                '3 - 3 месяца (рекомендуется)\n' +
                '6 - 6 месяцев\n' +
                '12 - 12 месяцев\n' +
                'Или введите другое число месяцев:'
            );
        } catch (error) {
            console.error('Ошибка при проверке имени:', error);
            await ctx.reply('Ошибка, попробуйте позже');
        }
    } else if (step === 'observation_period') {
        try {
            const observationMonths = parseInt(text);
            
            if (isNaN(observationMonths) || observationMonths < 1 || observationMonths > 60) {
                await ctx.reply('Пожалуйста, введите корректное число месяцев (от 1 до 60):');
                return;
            }
            
            try {
                const newUser = userRepository.createUser(telegramId, ctx.session.uniqueName, observationMonths);
                console.log('Пользователь сохранен', newUser);
                
                const endDate = new Date(newUser.observation_end_date);
                const formattedDate = endDate.toLocaleDateString('ru-RU');
                
                await ctx.reply(
                    `Регистрация завершена!\n` +
                    `Период наблюдения: ${observationMonths} месяцев.\n` +
                    `Дата окончания: ${formattedDate}.\n` +
                    `Автоматически отправляем первый опрос...`
                );
                
                setTimeout(async () => {
                    try {
                        // Проверяем, активен ли пользователь
                        const isActive = userRepository.isObservationActive(newUser.id);
                        if (isActive) {
                            // Устанавливаем сессию для пользователя
                            setSessionForSurvey(newUser.telegram_id, newUser);
                            
                            // Отправляем опрос
                            await sendSurveyToUser(newUser);
                            console.log(`Первый опрос успешно отправлен пользователю ${newUser.unique_name}`);
                        }
                    } catch (error) {
                        console.error(`Ошибка при отправке первого опроса пользователю ${newUser.unique_name}:`, error);
                    }
                }, 1000); // Задержка 1 секунда

                // Сбрасываем сессию
                ctx.session.step = 'idle';
                ctx.session.uniqueName = null;
                ctx.session.observationMonths = null;
            } catch (error) {
                console.error('Ошибка создания пользователя', error);
                if (error.code === 'SQLITE_CONSTRAINT') {
                    await ctx.reply('Такой пользователь уже существует');
                } else {
                    await ctx.reply('Ошибка сохранения данных');
                }
            }
        } catch (error) {
            console.error('Ошибка при обработке периода наблюдения:', error);
            await ctx.reply('Ошибка, попробуйте позже');
        }
    } else if (step === 'check') {
        if (text === "Все верно") {
            await completeSurvey(ctx, user)
            return
        } else if (text === "Заполнить заново") {
            console.log(`Пользователь ${telegramId} повторно заполняет опросник`)
            // Устанавливаем сессию
            ctx.session.step = 'survey';
            ctx.session.currentQuestion = 0;
            ctx.session.nextQuestion = 1,
            ctx.session.uniqueName = user.unique_name;
            ctx.session.userTelegramId = telegramId;

            const buttonRows = ANSWERS[0].map((label) => [Keyboard.text(label)]);
            const keyboard = Keyboard.from(buttonRows).resized();

            await ctx.reply(
                `Повторный запуск опросника\n\n${QUESTIONS[0]}`,
                { reply_markup: keyboard }
            );
            return
        }
    } else {
        // Общее сообщение для неизвестных команд
        await ctx.reply('Используйте /start для регистрации или /survey для начала опроса');
    }
});

// Обработка ошибок
bot.catch((err) => {
    console.error('Ошибка бота:', err);
});

// Запуск бота
bot.start().then(() => {
    console.log('Бот запущен!');
    console.log('Ежедневные опросы будут отправляться в 12:00 по времени сервера');
    
    const users = userRepository.getAllUsers();
    const activeUsers = userRepository.getActiveUsers();
    console.log(`Зарегистрировано пользователей: ${users.length}`);
    console.log(`Активных пользователей: ${activeUsers.length}`);
    
    // Очищаем устаревшие сессии при запуске (старше 24 часов)
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    for (const [key, session] of sessions.entries()) {
        if (now - session.lastActivity > dayInMs) {
            sessions.delete(key);
            console.log(`Удалена устаревшая сессия для пользователя ${key}`);
        }
    }
});