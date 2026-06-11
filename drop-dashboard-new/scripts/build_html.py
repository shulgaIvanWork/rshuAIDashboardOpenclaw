"""
build_html.py — генерирует HTML-дашборд из agg.json.
Результат сохраняется в OUTPUT_DIR/HTML_FILE (из config.py).
v2 — средневзвешенный срок WON, рейтинг источников под B2B/форматами, рекомендации.
"""
import json, os
import config

os.makedirs(config.OUTPUT_DIR, exist_ok=True)
agg = json.load(open(config.AGG_JSON, encoding="utf-8"))

weeks   = agg["weeks"]
ytd     = agg["ytd"]
pw      = agg["prev"]
cw      = agg["cur"]
kom_ytd  = agg["kom_ytd"]
kom_prev = agg["kom_prev"]
kom_cur  = agg["kom_cur"]
prev_w   = agg["prev_week"]
cur_w    = agg["cur_week"]


def fmt(n):
    try:
        return f"{n:,.0f}".replace(",", " ")
    except Exception:
        return str(n)


last  = weeks[-1]
prev  = weeks[-2] if len(weeks) > 1 else None
delta = ((last["postupleniya"] - prev["postupleniya"]) / prev["postupleniya"] * 100
         if prev and prev["postupleniya"] else 0)

labels_short = [f"W{w['week']:02d}" for w in weeks]
labels_full  = [w["label"] for w in weeks]
labels_dates = [w["label_dates"] for w in weeks]
pos      = [w["postupleniya"]    for w in weeks]
mql_a    = [w["mql"]             for w in weeks]
sql_a    = [w["sql"]             for w in weeks]
opl_a    = [w["oplata"]          for w in weeks]
conv_ms  = [w["conv_mql_sql"]    for w in weeks]
conv_so  = [w["conv_sql_oplata"] for w in weeks]
presale_dur = [w["avg_presale_dur"] for w in weeks]
won_n    = [w["won_cnt"]         for w in weeks]
lost_n   = [w["lost_cnt"]        for w in weeks]
avg_arr  = [w["avg_check"]       for w in weeks]
dur_arr  = [w["avg_dur"]         for w in weeks]

src      = agg["src_rating"][:15]
b2b      = agg["btype_ytd"].get("B2B", {"cnt": 0, "sum": 0})
b2c      = agg["btype_ytd"].get("B2C", {"cnt": 0, "sum": 0})
b2b_prev = agg["btype_prev"].get("B2B", {"cnt": 0, "sum": 0})
b2c_prev = agg["btype_prev"].get("B2C", {"cnt": 0, "sum": 0})
fmt_data_ytd  = sorted([(k, v) for k, v in agg["fmt_ytd"].items()  if k != "period"], key=lambda x: -x[1]["sum"])
fmt_data_prev = sorted([(k, v) for k, v in agg["fmt_prev"].items() if k != "period"], key=lambda x: -x[1]["sum"])
top20    = agg["top_products"]

COLORS = {"ОМ (Онлайн)": "#43A047", "ООМ (Очное)": "#1976D2", "СДО": "#F57C00", "КОМ": "#C62828"}


def card(label, value, sub="", cls=""):
    return f'<div class="kpi {cls}"><div class="lbl">{label}</div><div class="val">{value}</div><div class="sub">{sub}</div></div>'


# Таблица недель — УДАЛЕНА (по просьбе Анастасии: не показательно понедельно)

# Рейтинг источников
src_html = "".join(
    f"<tr><td>{i}</td><td>{s['name'] or '—'}</td><td>{s['deals']}</td><td>{s['leads']}</td><td><b>{fmt(s['postupleniya'])}</b> ₽</td></tr>"
    for i, s in enumerate(src, 1)
)

top_html = "".join(
    f"<tr><td>{i}</td><td>{tp['name']}</td><td>{tp['deals']}</td>"
    f"<td><b>{fmt(tp['sum'])}</b> ₽</td><td>{fmt(tp['avg_check'])} ₽</td></tr>"
    for i, tp in enumerate(top20, 1)
)

mgr_html = ""
for i, m in enumerate(agg["mgr_top"], 1):
    if isinstance(m, dict):
        nm = m.get("name","—"); ld = m.get("leads",0); wo = m.get("won",0)
        lo = m.get("lost",0);  cv = m.get("conv_pct",0)
        ac = m.get("avg_check",0); ps = m.get("postupleniya",0)
    else:
        nm = m[0]; ld = "—"; wo = m[1]; lo = "—"; cv = "—"; ac = int(m[2]/m[1]) if m[1] else 0; ps = m[2]
    mgr_html += (f"<tr><td>{i}</td><td>{nm}</td><td>{ld}</td><td>{wo}</td>"
                 f"<td>{lo}</td><td>{cv}%</td><td>{fmt(ac)} ₽</td><td><b>{fmt(ps)}</b> ₽</td></tr>")

# КОМ-блок
def kom_row(label, a, b, c, money=True, suf=""):
    def f(v):
        if money:
            return fmt(v) + " ₽"
        if isinstance(v, float):
            return f"{v:.1f}{suf}"
        return f"{fmt(v)}{suf}"
    return f"<tr><td>{label}</td><td>{f(a)}</td><td>{f(b)}</td><td>{f(c)}</td></tr>"

kom_html  = "<tr class='sec'><td colspan='4'>ПОСТУПЛЕНИЯ КОМ</td></tr>"
kom_html += kom_row("Поступления, ₽",        kom_ytd["postupleniya"],    kom_prev["postupleniya"],    kom_cur["postupleniya"])
kom_html += kom_row("WON сделок",            kom_ytd["won_relevant_cnt"],kom_prev["won_relevant_cnt"],kom_cur["won_relevant_cnt"], money=False)
kom_html += "<tr class='sec'><td colspan='4'>СТОИМОСТЬ СДЕЛКИ КОМ</td></tr>"
kom_html += kom_row("Средний чек, ₽",        kom_ytd["avg_check"],       kom_prev["avg_check"],       kom_cur["avg_check"])
kom_html += kom_row("Медианный чек, ₽",      kom_ytd["median_check"],    kom_prev["median_check"],    kom_cur["median_check"])
kom_html += kom_row("Максимальный чек, ₽",   kom_ytd["max_check"],       kom_prev["max_check"],       kom_cur["max_check"])
kom_html += "<tr class='sec'><td colspan='4'>СКОРОСТЬ ЗАКРЫТИЯ КОМ</td></tr>"
kom_html += kom_row("Среднее время WON, дн.", kom_ytd["avg_close_days_won_weighted"],  kom_prev["avg_close_days_won_weighted"],  kom_cur["avg_close_days_won_weighted"],  money=False)
kom_html += kom_row("Медиана WON, дн.",       kom_ytd["median_close_days_won"],kom_prev["median_close_days_won"],kom_cur["median_close_days_won"],money=False)
kom_html += kom_row("Среднее время LOSE, дн.",kom_ytd["avg_close_days_lose"], kom_prev["avg_close_days_lose"], kom_cur["avg_close_days_lose"], money=False)
kom_html += "<tr class='sec'><td colspan='4'>КОНВЕРСИЯ КОМ</td></tr>"
kom_html += kom_row("Проигранных",            kom_ytd["lose_cnt"],        kom_prev["lose_cnt"],        kom_cur["lose_cnt"],        money=False)
kom_html += kom_row("Конв. WON/(WON+LOSE), %",kom_ytd["conv_deal_pct"],   kom_prev["conv_deal_pct"],   kom_cur["conv_deal_pct"],   money=False, suf=" %")

fmt_html_ytd   = ""
total_fmt = sum(v["sum"] for _, v in fmt_data_ytd) or 1
for k, v in fmt_data_ytd:
    fmt_html_ytd += (
        f"<tr><td><span class='dot' style='background:{COLORS.get(k,'#999')}'></span>{k}</td>"
        f"<td>{v['cnt']}</td><td><b>{fmt(v['sum'])}</b> ₽</td>"
        f"<td>{v['sum']/total_fmt*100:.1f}%</td></tr>"
    )

def b2b_row(period, b, c):
    tot = b["sum"] + c["sum"] or 1
    return (
        f"<tr><td>{period}</td>"
        f"<td><span class='dot' style='background:#1976D2'></span>B2B</td>"
        f"<td>{b['cnt']}</td><td><b>{fmt(b['sum'])}</b> ₽</td><td>{b['sum']/tot*100:.1f}%</td></tr>"
        f"<tr><td></td>"
        f"<td><span class='dot' style='background:#F57C00'></span>B2C</td>"
        f"<td>{c['cnt']}</td><td><b>{fmt(c['sum'])}</b> ₽</td><td>{c['sum']/tot*100:.1f}%</td></tr>"
    )

b2b_html = b2b_row("YTD", b2b, b2c) + b2b_row(f"W{prev_w:02d}", b2b_prev, b2c_prev)

# === Рекомендации ===
conv_ytd = ytd['conv_deal_pct']
avg_check = ytd['avg_check']
avg_won_weighted = ytd['avg_close_days_won_weighted']
won_sd = ytd['won_relevant_cnt']
lose_sd = ytd['lose_cnt']
total_sd = won_sd + lose_sd
kom_share = kom_ytd['postupleniya'] / (ytd['postupleniya'] + kom_ytd['postupleniya']) * 100
b2b_share = b2b['sum'] / (b2b['sum'] + b2c['sum']) * 100 if (b2b['sum'] + b2c['sum']) else 0

# Лучший/худший источник по конверсии
src_sorted_deals = sorted(agg['src_rating'][1:], key=lambda x: -x.get('deals', 0))
top_src = src_sorted_deals[0]['name'] if src_sorted_deals else '—'
best_conv_src = max(agg['src_rating'][1:], key=lambda x: x.get('conv_sql_deals', 0) if x.get('deals', 0) >= 3 else 0)
worst_conv_src = min((s for s in agg['src_rating'][1:] if s.get('deals', 0) >= 3),
                      key=lambda x: x.get('conv_sql_deals', 0) if x.get('deals', 0) >= 3 else 999)

rec_html = f"""<h3>📊 Итоги YTD {config.YEAR}</h3>
<ul style="line-height:1.8;padding-left:20px">
  <li><strong>Поступления:</strong> {fmt(ytd['postupleniya'])} ₽ за {won_sd} сделок (средний чек {fmt(avg_check)} ₽)</li>
  <li><strong>Средневзвешенный срок до оплаты:</strong> {avg_won_weighted:.1f} дн. — крупные сделки «тянут» срок вверх (медиана {ytd['median_close_days_won']:.0f} дн.)</li>
  <li><strong>Конверсия WON/(WON+LOSE):</strong> {conv_ytd:.1f}% — {won_sd} побед из {total_sd} закрытых сделок</li>
  <li><strong>КОМ:</strong> {fmt(kom_ytd['postupleniya'])} ₽ ≈ {kom_share:.1f}% от общего объёма ({kom_ytd['won_relevant_cnt']} сделок)</li>
  <li><strong>B2B:</strong> {b2b_share:.1f}% поступлений (доминирующий сегмент)</li>
  <li><strong>ТОП-источник:</strong> {top_src} — {fmt(src_sorted_deals[0].get('postupleniya', 0))} ₽</li>
  <li><strong>Лучшая конв. источника:</strong> {best_conv_src.get('name', '—')} ({best_conv_src.get('conv_sql_deals', 0):.1f}%, ≥3 сделок)</li>
  <li><strong>Худшая конв. источника:</strong> {worst_conv_src.get('name', '—')} ({worst_conv_src.get('conv_sql_deals', 0):.1f}%)</li>
</ul>"""

html = f"""<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0"><title>Отчёт по продажам — {config.YEAR}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  *{{box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;margin:0;background:#f4f6fb;color:#1f2a44;line-height:1.5}}
  .wrap{{max-width:1500px;margin:0 auto;padding:24px}}
  h1{{font-size:28px;margin:0 0 4px}}
  .sub{{color:#677;margin-bottom:24px}}
  .kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}}
  .kpi{{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.06);border-top:3px solid #C8A45C}}
  .kpi.kom{{border-top-color:#9B2D3C}}
  .kpi .lbl{{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em}}
  .kpi .val{{font-size:22px;font-weight:700;margin:6px 0 2px;color:#1f2a44}}
  .kpi .sub{{font-size:12px;color:#888;margin:0}}
  .card{{background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
  .card.kom{{border-left:4px solid #9B2D3C}}
  .rec-card{{background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06);border-left:4px solid #C8A45C}}
  h2{{margin-top:0}}
  table{{width:100%;border-collapse:collapse;font-size:14px}}
  th{{background:#1f2a44;color:#fff;padding:10px;text-align:left;font-weight:600;position:sticky;top:0}}
  .kom th{{background:#9B2D3C}}
  td{{padding:9px 10px;border-bottom:1px solid #eef0f5}}
  tr:hover td{{background:#f8f9fc}}
  tr.cur td{{background:#fff8e1;font-weight:600}}
  tr.sec td{{background:#9B2D3C;color:#fff;font-weight:700;letter-spacing:.05em;font-size:12px;text-transform:uppercase}}
  .threecol{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}}
  .twocol{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}
  h3{{margin:0 0 12px;font-size:16px}}
  .chartbox{{position:relative;height:340px}}
  .chartbox-sm{{position:relative;height:240px}}
  .dt{{font-size:11px;color:#888;font-weight:400}}
  .dot{{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}}
  .extras td:nth-child(1){{font-weight:600;width:36%}}
  .extras td{{text-align:right}}
  .extras td:first-child{{text-align:left}}
  .src-table th{{background:#1f2a44}}
  .src-table td:nth-child(2){{text-align:left}}
  .src-table td:nth-child(3),.src-table td:nth-child(4),.src-table td:nth-child(5){{text-align:right}}
  .src-table td:nth-child(1){{text-align:center;width:36px}}
  .rec{{font-size:14px;line-height:1.7}}
  .rec ul{{margin:0;padding-left:20px}}
  .rec li{{margin-bottom:4px}}
  @media (max-width:900px){{.kpis{{grid-template-columns:repeat(2,1fr)}}.twocol,.threecol{{grid-template-columns:1fr}}}}
</style></head><body><div class="wrap">

<h1>Отчёт по продажам — {config.YEAR} год</h1>
<div class="sub">Битрикс24 · актуально на {agg['today']} · группировка по ISO-неделям W01–W{cur_w:02d} · только сделки с суммой ≥ 1 ₽ · исключены служебные воронки «Pre Sale» и «КОМ (Sale)»</div>

<div class="kpis">
  {card("Поступления YTD",   fmt(ytd['postupleniya'])+" ₽",          f"{ytd['won_relevant_cnt']} сделок")}
  {card("Средний чек YTD",   fmt(ytd['avg_check'])+" ₽",             f"медиана {fmt(ytd['median_check'])} ₽")}
  {card("Срок WON, дн. (ср.взв.)", f"{ytd['avg_close_days_won_weighted']:.1f}", f"средняя {ytd['avg_close_days_won']:.1f} · медиана {ytd['median_close_days_won']:.0f} дн.")}
  {card("Лидов YTD",         f"{agg['leads_ytd']:,}".replace(',', ' '), f"конв. WON/(W+L) {conv_ytd:.1f}%")}
  {card(f"W{prev_w:02d}: поступления", fmt(pw['postupleniya'])+" ₽", f"{pw['won_relevant_cnt']} сделок · {('+' if delta>=0 else '')}{delta:.1f}% к пред.")}
  {card(f"W{prev_w:02d}: ср.чек",      fmt(pw['avg_check'])+" ₽",   "")}
  {card(f"W{prev_w:02d}: срок WON",    f"{pw['avg_close_days_won_weighted']:.1f} дн. (ср.взв.)", "")}
  {card("Поступления КОМ YTD", fmt(kom_ytd['postupleniya'])+" ₽", f"{kom_ytd['won_relevant_cnt']} сделок · отдельный учёт", cls="kom")}
</div>

<div class="card"><h2>Воронка MQL → SQL → Оплата по неделям</h2>
<div class="sub" style="margin:-8px 0 16px">MQL = новые в Pre Sale. SQL = WON в Pre Sale (передано в ОП). Оплата = WON ≥1₽.</div>
<div class="chartbox"><canvas id="ch_funnel"></canvas></div>
</div>

<div class="twocol">
  <div class="card"><h2>Конверсии воронки, %</h2><div class="chartbox"><canvas id="ch_funconv"></canvas></div></div>
  <div class="card"><h2>Поступления по неделям, ₽</h2><div class="chartbox"><canvas id="ch_pos"></canvas></div></div>
</div>

<div class="card kom"><h2 style="color:#9B2D3C">КОМ (Sale) — отдельный блок</h2>
<div class="sub" style="margin:-8px 0 16px">«Копии для статистики» — крупные корпоративные договоры. В основные поступления НЕ включены.</div>
<table class="kom extras"><thead><tr><th></th><th>YTD</th><th>W{prev_w:02d}</th><th>W{cur_w:02d}</th></tr></thead>
<tbody>{kom_html}</tbody></table>
</div>

<div class="threecol">
  <div class="card"><h2>B2B vs B2C</h2>
  <div class="chartbox-sm"><canvas id="ch_b2b"></canvas></div>
  <table style="margin-top:14px"><thead><tr><th>Период</th><th>Тип</th><th>Сд.</th><th>Поступления, ₽</th><th>Доля</th></tr></thead>
  <tbody>{b2b_html}</tbody></table></div>

  <div class="card"><h2>Форматы обучения (YTD)</h2>
  <div class="chartbox-sm"><canvas id="ch_fmt"></canvas></div>
  <table style="margin-top:14px"><thead><tr><th>Формат</th><th>Сд.</th><th>Поступления, ₽</th><th>Доля</th></tr></thead>
  <tbody>{fmt_html_ytd}</tbody></table></div>

  <div class="card"><h2>Рейтинг источников (ТОП-15)</h2>
  <div style="max-height:440px;overflow:auto">
  <table class="src-table sortable" id="tbl-src"><thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Источник</th><th class="sort" data-col="2">WON</th><th class="sort" data-col="3">Лидов</th><th class="sort" data-col="4">Поступления, ₽</th></tr></thead>
  <tbody>{src_html}</tbody></table></div></div>
</div>

<div class="card"><h2>ТОП-20 продуктов по поступлениям YTD <span style="font-size:13px;color:#888;font-weight:400">(без КОМ и Post Sale)</span></h2>
<div style="overflow-x:auto"><table class="sortable" id="tbl-products"><thead><tr><th class="sort" data-col="0">#</th><th class="sort" data-col="1">Продукт</th><th class="sort" data-col="2">Сделок</th><th class="sort" data-col="3">Поступления, ₽</th><th class="sort" data-col="4">Средний чек, ₽</th></tr></thead>
<tbody>{top_html}</tbody></table></div>
</div>

<div class="card"><h2>Менеджеры YTD <span style="font-size:13px;color:#888;font-weight:400">(основная воронка · лиды из CRM)</span></h2>
<div style="overflow-x:auto"><table class="sortable" id="tbl-mgr"><thead><tr>
  <th class="sort" data-col="0">#</th><th class="sort" data-col="1">Менеджер</th><th class="sort" data-col="2">Лидов CRM</th><th class="sort" data-col="3">WON</th><th class="sort" data-col="4">Проигр</th><th class="sort" data-col="5">Конв.%</th><th class="sort" data-col="6">Ср. чек, ₽</th><th class="sort" data-col="7">Поступления, ₽</th>
</tr></thead>
<tbody>{mgr_html}</tbody></table></div>
</div>

<div class="twocol">
  <div class="card"><h2>Кол-во сделок: WON vs LOSE</h2><div class="chartbox"><canvas id="ch_cnt"></canvas></div></div>
  <div class="card"><h2>Средний чек по неделям, ₽</h2><div class="chartbox"><canvas id="ch_avg"></canvas></div></div>
</div>

<div class="twocol">
  <div class="card"><h2>Скорость закрытия WON, дн.</h2><div class="chartbox"><canvas id="ch_dur"></canvas></div></div>
  <div class="card"><h2>Скорость Pre Sale (MQL→SQL), дн.</h2><div class="chartbox"><canvas id="ch_presale"></canvas></div></div>
</div>

<div class="rec-card"><h2>📋 Итоги и рекомендации</h2>
<div class="rec">{rec_html}</div>
</div>

<div class="sub" style="text-align:center;margin-top:16px">Сформировано автоматически из Битрикс24 · {config.YEAR}</div>
</div>

<script>
const L = {json.dumps(labels_short)};
const Lfull = {json.dumps(labels_full)};
const Ldates = {json.dumps(labels_dates)};
const pos = {json.dumps(pos)};
const mql = {json.dumps(mql_a)};
const sql = {json.dumps(sql_a)};
const opl = {json.dumps(opl_a)};
const cms = {json.dumps(conv_ms)};
const cso = {json.dumps(conv_so)};
const presale = {json.dumps(presale_dur)};
const won_n = {json.dumps(won_n)};
const lost_n = {json.dumps(lost_n)};
const avg = {json.dumps(avg_arr)};
const dur = {json.dumps(dur_arr)};
const navy="#1f2a44", gold="#C8A45C", red="#C62828", green="#2E7D32", orange="#F57C00", blue="#1976D2";
function ruFmt(v){{return new Intl.NumberFormat('ru-RU').format(Math.round(v));}}

// === Сортировка таблиц (как в Excel) ===
document.addEventListener('DOMContentLoaded',()=>{{
  document.querySelectorAll('.sortable').forEach(tbl=>{{
    const ths = tbl.querySelectorAll('thead th.sort');
    ths.forEach(th=>{{
      th.addEventListener('click',()=>{{
        const col = parseInt(th.dataset.col);
        const tbody = tbl.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const isAsc = th.classList.contains('asc');
        // reset all arrows
        ths.forEach(h=>h.classList.remove('asc','desc'));
        th.classList.add(isAsc?'desc':'asc');
        rows.sort((a,b)=>{{
          let va = a.cells[col]?.innerText.trim() || '';
          let vb = b.cells[col]?.innerText.trim() || '';
          // Parse numeric: remove spaces, ₽, %, дн., commas
          let na = parseFloat(va.replace(/[^\d\-.,]/g,'').replace(',',''));
          let nb = parseFloat(vb.replace(/[^\d\-.,]/g,'').replace(',',''));
          if (!isNaN(na) && !isNaN(nb)) {{
            return isAsc ? na - nb : nb - na;
          }}
          return isAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        }});
        rows.forEach(r=>tbody.appendChild(r));
      }});
    }});
  }});
}});
const tipTitle = {{callbacks:{{title:items=>Lfull[items[0].dataIndex]}}}};

new Chart(document.getElementById("ch_funnel"), {{type:'bar',
  data:{{labels:L, datasets:[
    {{label:'MQL',data:mql,backgroundColor:blue,borderRadius:4}},
    {{label:'SQL',data:sql,backgroundColor:gold,borderRadius:4}},
    {{label:'Оплата',data:opl,backgroundColor:green,borderRadius:4}}
  ]}},
  options:{{plugins:{{tooltip:tipTitle}}, scales:{{y:{{ticks:{{callback:v=>v}}}}}}}}}});

new Chart(document.getElementById("ch_funconv"), {{type:'line',
  data:{{labels:L, datasets:[
    {{label:'MQL→SQL, %',data:cms,borderColor:blue,backgroundColor:'rgba(25,118,210,.1)',tension:0.3,fill:true}},
    {{label:'SQL→Оплата, %',data:cso,borderColor:green,backgroundColor:'rgba(46,125,50,.1)',tension:0.3,fill:true}}
  ]}},
  options:{{plugins:{{tooltip:tipTitle}}, scales:{{y:{{ticks:{{callback:v=>v+'%'}}}}}}}}}});

new Chart(document.getElementById("ch_pos"), {{type:'bar',
  data:{{labels:L, datasets:[{{label:'Поступления, ₽',data:pos,backgroundColor:navy,borderRadius:4}}]}},
  options:{{plugins:{{legend:{{display:false}},tooltip:{{callbacks:{{title:items=>Lfull[items[0].dataIndex],label:c=>ruFmt(c.parsed.y)+' ₽'}}}}}},scales:{{y:{{ticks:{{callback:v=>ruFmt(v)}}}}}}}}}});

new Chart(document.getElementById("ch_b2b"), {{type:'doughnut',
  data:{{labels:['B2B','B2C'], datasets:[{{data:[{b2b['sum']},{b2c['sum']}], backgroundColor:[blue,orange]}}]}},
  options:{{plugins:{{tooltip:{{callbacks:{{label:c=>c.label+': '+ruFmt(c.parsed)+' ₽'}}}}}}}}}});

new Chart(document.getElementById("ch_fmt"), {{type:'doughnut',
  data:{{labels:{json.dumps([k for k,_ in fmt_data_ytd])}, datasets:[{{data:{json.dumps([v["sum"] for _,v in fmt_data_ytd])}, backgroundColor:['#1976D2','#F57C00','#43A047']}}]}},
  options:{{plugins:{{tooltip:{{callbacks:{{label:c=>c.label+': '+ruFmt(c.parsed)+' ₽'}}}}}}}}}});

new Chart(document.getElementById("ch_cnt"), {{type:'bar',
  data:{{labels:L, datasets:[{{label:'Выиграно',data:won_n,backgroundColor:green}},{{label:'Проиграно',data:lost_n,backgroundColor:red}}]}},
  options:{{plugins:{{tooltip:tipTitle}}}}}});

new Chart(document.getElementById("ch_avg"), {{type:'line',
  data:{{labels:L, datasets:[{{label:'Сред.чек, ₽',data:avg,borderColor:gold,backgroundColor:'rgba(200,164,92,.15)',tension:0.3,fill:true}}]}},
  options:{{plugins:{{legend:{{display:false}},tooltip:{{callbacks:{{title:items=>Lfull[items[0].dataIndex],label:c=>ruFmt(c.parsed.y)+' ₽'}}}}}},scales:{{y:{{ticks:{{callback:v=>ruFmt(v)}}}}}}}}}});

new Chart(document.getElementById("ch_dur"), {{type:'line',
  data:{{labels:L, datasets:[{{label:'Сред.срок WON, дн.',data:dur,borderColor:navy,backgroundColor:'rgba(31,42,68,.15)',tension:0.3,fill:true}}]}},
  options:{{plugins:{{legend:{{display:false}},tooltip:tipTitle}}, scales:{{y:{{ticks:{{callback:v=>v+' дн.'}}}}}}}}}});

new Chart(document.getElementById("ch_presale"), {{type:'line',
  data:{{labels:L, datasets:[{{label:'Pre Sale, дн.',data:presale,borderColor:blue,backgroundColor:'rgba(25,118,210,.15)',tension:0.3,fill:true}}]}},
  options:{{plugins:{{legend:{{display:false}},tooltip:tipTitle}}, scales:{{y:{{ticks:{{callback:v=>v+' дн.'}}}}}}}}}});
</script>
</body></html>"""

out_path = os.path.join(config.OUTPUT_DIR, config.HTML_FILE)
open(out_path, "w", encoding="utf-8").write(html)
print(f"HTML готов → {out_path}")
