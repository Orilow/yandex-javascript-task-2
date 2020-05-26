'use strict';
const isStar = true;
const WEEK_DAYS = { ПН: 0, ВТ: 1, СР: 2, ЧТ: 3, ПТ: 4, СБ: 5, ВС: 6 };
const WEEK_DAY_NUMBERS = { 0: 'ПН', 1: 'ВТ', 2: 'СР', 3: 'ЧТ', 4: 'ПТ', 5: 'СБ', 6: 'ВС' };
const MINUTES_IN_HOUR = 60;
const MINUTES_IN_DAY = 1440;
const TRY_LATER_MINUTES = 30;
const NIGHTS_AMOUNT = 8;
const TIMEOUT_TIME = 3 * 24 * 60;

function defineBankTimeZone(hours) {
    return Number(hours.from.match(/[+-]\d{1,2}/)[0]);
}

function getUnitedSchedule(schedule) {
    return [].concat.apply([], Object.values(schedule));
}

function mapTimeToTimePeriods(unitedSchedule, bankTimeZone) {
    return unitedSchedule.map(x => {
        return {
            from: getTimestamp(x.from, bankTimeZone),
            to: getTimestamp(x.to, bankTimeZone)
        };
    });
}

function getTimestamp(timeStr, bankTimeZone) {
    const weekDayMatch = timeStr.match(/[А-Я]{2}/);
    const weekDay = weekDayMatch === null ? 0 : WEEK_DAYS[weekDayMatch];
    const time = timeStr.match(/(\d{2}):(\d{2})\+(\d{1,2})/);
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    const timezone = Number(time[3]);
    let timestamp = weekDay * MINUTES_IN_DAY +
        hours * MINUTES_IN_HOUR +
        minutes;
    if (bankTimeZone !== timezone) {
        timestamp += (bankTimeZone - timezone) * MINUTES_IN_HOUR;
    }

    return timestamp;
}

function addBankCloseTimePeriods(periods, bankHours, bankTimeZone) {
    let bankClosedPeriods = [];
    for (let i = 0; i < NIGHTS_AMOUNT; i++) {
        const closed = {
            from: getTimestamp(bankHours.to, bankTimeZone) + (i - 1) * MINUTES_IN_DAY,
            to: getTimestamp(bankHours.from, bankTimeZone) + i * MINUTES_IN_DAY
        };

        bankClosedPeriods.push(closed);
    }

    return periods.concat(bankClosedPeriods);
}

function periodsSorter(a, b) {
    if (a.from < b.from) {
        return -1;
    }
    if (a.from > b.from) {
        return 1;
    }

    return 0;
}

function getBusyPeriods(unitedSchedule, workingHours, bankTimeZone) {
    const periods = mapTimeToTimePeriods(unitedSchedule, bankTimeZone);
    const updatedPeriods = addBankCloseTimePeriods(periods, workingHours, bankTimeZone);

    return updatedPeriods.sort(periodsSorter);
}

function getUnitedTimePeriods(busyTimePeriods) {
    let united = [];
    for (let period of busyTimePeriods) {
        addPeriod(united, period);
    }

    return united;
}

function addPeriod(united, period) {
    let added = false;
    for (let i = 0; i < united.length; i++) {
        if (united[i].from > period.to || united[i].to < period.from) {
            continue;
        }
        united[i].from = Math.min(united[i].from, period.from);
        united[i].to = Math.max(united[i].to, period.to);
        added = true;
    }
    if (!added) {
        united.push(period);
    }
}

function removePeriodsAfterTimeOut(periods, timeout) {
    return periods.filter(x => x.from < timeout);
}

function getStartPoints(periods, duration) {
    let points = [];
    function tryFindStartPoint(startFreeTime, endFreeTime) {
        let changeableStartTime = startFreeTime;
        let gap = endFreeTime - startFreeTime;
        while (gap >= duration) {
            points.push(changeableStartTime);
            changeableStartTime += TRY_LATER_MINUTES;
            gap -= TRY_LATER_MINUTES;
        }
    }

    for (let i = 0; i < periods.length - 1; i++) {
        tryFindStartPoint(periods[i].to, periods[i + 1].from);
    }

    return points;
}

/**
 * @param {Object} schedule – Расписание Банды
 * @param {Number} duration - Время на ограбление в минутах
 * @param {Object} workingHours – Время работы банка
 * @param {String} workingHours.from – Время открытия, например, "10:00+5"
 * @param {String} workingHours.to – Время закрытия, например, "18:00+5"
 * @returns {Object}
 */
function getAppropriateMoment(schedule, duration, workingHours) {
    const bankTimeZone = defineBankTimeZone(workingHours);

    const unitedSchedule = getUnitedSchedule(schedule);
    const busyTimePeriods = getBusyPeriods(unitedSchedule, workingHours, bankTimeZone);
    const unitedBusyTimePeriods = getUnitedTimePeriods(busyTimePeriods);
    const timePeriodsBeforeTimeOut = removePeriodsAfterTimeOut(unitedBusyTimePeriods, TIMEOUT_TIME);
    const startPoints = getStartPoints(timePeriodsBeforeTimeOut, duration);

    return {
        counter: 0,
        startPoints: startPoints,

        /**
         * Найдено ли время
         * @returns {Boolean}
         */
        exists: function () {
            return this.counter < this.startPoints.length;
        },

        /**
         * Возвращает отформатированную строку с часами для ограбления
         * Например, "Начинаем в %HH:%MM (%DD)" -> "Начинаем в 14:59 (СР)"
         * @param {String} template
         * @returns {String}
         */
        format: function (template) {
            if (this.startPoints.length === 0) {
                return '';
            }

            function getTime(timestamp) {
                const day = Math.floor(timestamp / MINUTES_IN_DAY);
                let minutesToSubtract = day * MINUTES_IN_DAY;
                const hour = Math.floor((timestamp - minutesToSubtract) / MINUTES_IN_HOUR);
                minutesToSubtract += hour * MINUTES_IN_HOUR;
                const minute = timestamp - minutesToSubtract;

                return { day, hour, minute };
            }

            function addZero(number) {
                if (number < 10) {
                    return '0' + number;
                }

                return number;
            }

            const time = getTime(this.startPoints[this.counter]);

            return template.replace(/%DD/, WEEK_DAY_NUMBERS[time.day])
                .replace(/%HH/, addZero(time.hour))
                .replace(/%MM/, addZero(time.minute));
        },

        /**
         * Попробовать найти часы для ограбления позже [*]
         * @star
         * @returns {Boolean}
         */
        tryLater: function () {
            if (this.counter + 1 < this.startPoints.length) {
                this.counter += 1;

                return true;
            }

            return false;
        }
    };
}

module.exports = { getAppropriateMoment, isStar };
