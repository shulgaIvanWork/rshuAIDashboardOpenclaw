/**
 * range-calendar.js — лёгкий попап-календарь для выбора диапазона дат (без зависимостей).
 *
 * Замена Flatpickr на свой дизайн (макет: https://codepen.io/Markshall/pen/ExPxpYX,
 * переведён на русский, начало+конец выбираются в одном календаре).
 *
 * Использование:
 *   RangeCalendar.attach(inputEl, {
 *     start: '2026-01-01', end: '2026-07-09',   // необязательно, ISO YYYY-MM-DD
 *     onApply: function(startISO, endISO) { ... },
 *   });
 *
 * Возвращает объект с методом .setRange(startISO, endISO) — обновить программно
 * (например, при первой загрузке данных), не открывая попап.
 */
(function (global) {
  var MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var WEEKDAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }
  function parseIso(s) {
    if (!s) return null;
    var p = s.split('-');
    return { y: parseInt(p[0], 10), m: parseInt(p[1], 10) - 1, d: parseInt(p[2], 10) };
  }
  function fmtDisplay(s) {
    if (!s) return '';
    var p = s.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  // Понедельник = 0 ... Воскресенье = 6 (JS Date.getDay() возвращает 0=Вс)
  function mondayIndex(jsDay) { return (jsDay + 6) % 7; }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  function RangeCalendarInstance(input, opts) {
    this.input = input;
    this.opts = opts || {};
    this.start = parseIso(this.opts.start) ? this.opts.start : null;
    this.end = parseIso(this.opts.end) ? this.opts.end : null;
    var base = parseIso(this.start) || { y: new Date().getFullYear(), m: new Date().getMonth() };
    this.viewYear = base.y;
    this.viewMonth = base.m;
    this._picking = 'start'; // следующий клик задаёт начало или конец диапазона
    this._buildDom();
    this._renderInputValue();
    this._bindEvents();
  }

  RangeCalendarInstance.prototype._buildDom = function () {
    var wrap = document.createElement('div');
    wrap.className = 'rc-calendar';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="rc-calendar__opts">' +
        '<select class="rc-calendar__month"></select>' +
        '<select class="rc-calendar__year"></select>' +
      '</div>' +
      '<div class="rc-calendar__body">' +
        '<div class="rc-calendar__days"></div>' +
        '<div class="rc-calendar__dates"></div>' +
      '</div>' +
      '<div class="rc-calendar__buttons">' +
        '<button type="button" class="rc-calendar__button rc-calendar__button--grey" data-action="cancel">Отмена</button>' +
        '<button type="button" class="rc-calendar__button rc-calendar__button--primary" data-action="apply">Применить</button>' +
      '</div>';
    document.body.appendChild(wrap);
    this.dom = wrap;

    var daysEl = wrap.querySelector('.rc-calendar__days');
    WEEKDAYS.forEach(function (d) {
      var el = document.createElement('div');
      el.textContent = d;
      daysEl.appendChild(el);
    });

    var monthSel = wrap.querySelector('.rc-calendar__month');
    MONTHS.forEach(function (name, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = name;
      monthSel.appendChild(o);
    });

    var yearSel = wrap.querySelector('.rc-calendar__year');
    var curYear = new Date().getFullYear();
    for (var y = curYear - 5; y <= curYear + 1; y++) {
      var oy = document.createElement('option');
      oy.value = y; oy.textContent = y;
      yearSel.appendChild(oy);
    }

    this._renderGrid();
  };

  RangeCalendarInstance.prototype._renderGrid = function () {
    var wrap = this.dom;
    wrap.querySelector('.rc-calendar__month').value = this.viewMonth;
    wrap.querySelector('.rc-calendar__year').value = this.viewYear;

    var datesEl = wrap.querySelector('.rc-calendar__dates');
    datesEl.innerHTML = '';

    var y = this.viewYear, m = this.viewMonth;
    var firstDow = mondayIndex(new Date(y, m, 1).getDay());
    var totalDays = daysInMonth(y, m);
    var prevTotalDays = daysInMonth(y, m - 1 < 0 ? 11 : m - 1);
    var prevY = m === 0 ? y - 1 : y, prevM = m === 0 ? 11 : m - 1;
    var nextY = m === 11 ? y + 1 : y, nextM = m === 11 ? 0 : m + 1;

    var cells = [];
    for (var i = firstDow - 1; i >= 0; i--) {
      cells.push({ y: prevY, m: prevM, d: prevTotalDays - i, grey: true });
    }
    for (var d = 1; d <= totalDays; d++) {
      cells.push({ y: y, m: m, d: d, grey: false });
    }
    var nextD = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ y: nextY, m: nextM, d: nextD++, grey: true });
    }

    var self = this;
    cells.forEach(function (c) {
      var cellIso = iso(c.y, c.m, c.d);
      var el = document.createElement('div');
      el.className = 'rc-calendar__date' + (c.grey ? ' rc-calendar__date--grey' : '');
      el.innerHTML = '<span>' + c.d + '</span>';

      if (!c.grey && self.start) {
        var inRange = self.end ? (cellIso >= self.start && cellIso <= self.end) : cellIso === self.start;
        if (inRange) {
          el.className += ' rc-calendar__date--selected';
          if (cellIso === self.start) el.className += ' rc-calendar__date--range-start';
          if (cellIso === (self.end || self.start)) el.className += ' rc-calendar__date--range-end';
        }
      }

      if (!c.grey) {
        el.addEventListener('click', function () { self._onDateClick(cellIso); });
      }
      datesEl.appendChild(el);
    });
  };

  RangeCalendarInstance.prototype._onDateClick = function (clickedIso) {
    if (this.opts.mode === 'single') {
      // Один клик — выбор даты; попап остаётся открытым до нажатия «Применить»
      this.start = clickedIso;
      this.end = clickedIso;
      this._renderGrid();
      return;
    }
    if (this._picking === 'start') {
      this.start = clickedIso;
      this.end = null;
      this._picking = 'end';
    } else {
      if (clickedIso < this.start) {
        this.end = this.start;
        this.start = clickedIso;
      } else {
        this.end = clickedIso;
      }
      this._picking = 'start';
    }
    this._renderGrid();
  };

  RangeCalendarInstance.prototype._renderInputValue = function () {
    if (this.opts.mode === 'single') {
      this.input.value = this.start ? fmtDisplay(this.start) : '';
    } else if (this.start && this.end) {
      this.input.value = fmtDisplay(this.start) + '—' + fmtDisplay(this.end);
    } else if (this.start) {
      this.input.value = fmtDisplay(this.start) + '—…';
    } else {
      this.input.value = '';
    }
  };

  RangeCalendarInstance.prototype._bindEvents = function () {
    var self = this;

    this.input.addEventListener('click', function () { self.open(); });
    this.input.setAttribute('readonly', 'readonly');

    this.dom.querySelector('.rc-calendar__month').addEventListener('change', function (e) {
      self.viewMonth = parseInt(e.target.value, 10);
      self._renderGrid();
    });
    this.dom.querySelector('.rc-calendar__year').addEventListener('change', function (e) {
      self.viewYear = parseInt(e.target.value, 10);
      self._renderGrid();
    });
    var cancelBtn = this.dom.querySelector('[data-action="cancel"]');
    var applyBtn = this.dom.querySelector('[data-action="apply"]');
    cancelBtn.addEventListener('click', function () { self.close(); });
    applyBtn.addEventListener('click', function () {
      var ready = self.opts.mode === 'single' ? !!self.start : (self.start && self.end);
      if (ready) {
        self._renderInputValue();
        self.close();
        if (typeof self.opts.onApply === 'function') self.opts.onApply(self.start, self.end);
      }
    });

    // Клик по дате пересоздаёт сетку (_renderGrid переписывает innerHTML), поэтому
    // e.target к моменту всплытия до document может уже быть отсоединён от DOM —
    // .contains(e.target) в этом случае ошибочно вернёт false. composedPath()
    // фиксирует путь на момент диспатча события и не зависит от последующих мутаций.
    document.addEventListener('click', function (e) {
      if (self.dom.style.display === 'none') return;
      var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (e.target === self.input || path.indexOf(self.dom) !== -1 || self.dom.contains(e.target)) return;
      self.close();
    });
  };

  RangeCalendarInstance.prototype.open = function () {
    var r = this.input.getBoundingClientRect();
    this.dom.style.position = 'absolute';
    this.dom.style.top = (window.scrollY + r.bottom + 4) + 'px';
    this.dom.style.left = (window.scrollX + r.left) + 'px';
    this.dom.style.display = 'block';
    this._renderGrid();
  };

  RangeCalendarInstance.prototype.close = function () {
    this.dom.style.display = 'none';
  };

  RangeCalendarInstance.prototype.setRange = function (startISO, endISO) {
    this.start = startISO || null;
    this.end = endISO || null;
    this._picking = 'start';
    var base = parseIso(this.start);
    if (base) { this.viewYear = base.y; this.viewMonth = base.m; }
    this._renderInputValue();
    this._renderGrid();
  };

  global.RangeCalendar = {
    attach: function (input, opts) { return new RangeCalendarInstance(input, opts); },
  };
})(window);
