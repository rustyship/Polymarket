from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import json
import math
import pandas as pd
from py_clob_client.client import ClobClient
from pydantic import AnyHttpUrl, BaseModel, field_serializer
import requests
from typing import List, Optional
from zoneinfo import ZoneInfo
from sqlalchemy import text, create_engine
import os
import re
import pandas as pd
import numpy as np
import math
from decimal import Decimal
from numpy.polynomial import Polynomial
from pydantic import BaseModel, ValidationError, ConfigDict

app = FastAPI()

# Allow your Vite dev server to talk to the API. Adjust for prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#Creates enginge for sql calls
engine = create_engine(
    "postgresql+psycopg://postgres:Annie4878@localhost:5432/polymarket",
    future=True,
    connect_args={"options": "-csearch_path=analytics,public"}  # so you can say INSERT INTO prices ...
)

class AlignedData(BaseModel):
    alignedData: List[List[float]] | None

class PricePoint(BaseModel):
    t: float
    p: float

class PriceSeries(BaseModel):
    name: str
    points: List[PricePoint]


class nameIdPair(BaseModel):
    marketName: str
    marketID: str

class BaseParams(BaseModel):
    nameID : nameIdPair
    start: datetime
    end: datetime
    fidelity: int

def to_unix_seconds(dt: datetime) -> int:
    """
    Convert a timezone-aware datetime to integer Unix seconds.
    Uses floor, so pre-1970 times don't get off-by-one from truncation.
    """
    if dt.tzinfo is None:
        raise ValueError("datetime must be timezone-aware (has tzinfo)")
    return math.floor(dt.timestamp())

def to_timestamptz(s: str) -> datetime:
    """
    Parse strings like:
    'Wed Sep 03 2025 15:21:39 GMT-0400 (Eastern Daylight Time)'
    and return an aware datetime (UTC) suitable for Postgres timestamptz.
    """
    # Drop the parenthetical tz name, keep the numeric offset
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s.strip())
    # Parse with the fixed 'GMT±HHMM' offset
    dt = datetime.strptime(s, "%a %b %d %Y %H:%M:%S GMT%z")
    # Normalize to UTC (Postgres stores timestamptz as an instant)
    return dt.astimezone(timezone.utc)




@app.get("/markets/names", response_model=List[nameIdPair])
def get_market_names(limit: int = 50, offset: int = 0, top_k: int = 50):
    """
    Return up to `limit` markets from the TOP `top_k` most-populated market_ids
    (by row count in analytics_2_0.market_prices), joined to names.
    Ordered by count desc, then name asc. Offset for paging within that top set.
    """
    sql = text("""
        WITH top_ids AS (
            SELECT market_id, COUNT(*) AS n
            FROM analytics_2_0.market_prices
            GROUP BY market_id
            ORDER BY n DESC
            LIMIT :top_k
        )
        SELECT m.market_id, m.market_name, t.n
        FROM top_ids t
        JOIN analytics_2_0.markets m
          ON m.market_id = t.market_id
        WHERE m.market_name IS NOT NULL
        ORDER BY t.n DESC, m.market_name ASC
        LIMIT :limit OFFSET :offset
    """)
    params = {"top_k": top_k, "limit": limit, "offset": offset}

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    return [{"marketName": r["market_name"], "marketID": r["market_id"]} for r in rows]

def getPrices(base_param: BaseParams):

    market_id = base_param.nameID.marketID
    start = base_param.start
    end = base_param.end

    fidelity = base_param.fidelity

    sql = text("""SELECT t, price
                FROM analytics_2_0.market_prices
                WHERE market_id = :market_id
                AND t >= :start AND t < :end
                AND EXTRACT(SECOND FROM t) = 0
                AND (EXTRACT(MINUTE FROM t)::int % :fidelity) = 0
                ORDER BY t;""")
    
    params = {"market_id": market_id, "start": start, "end": end, "fidelity": fidelity}
    print(params)
    with engine.begin() as conn:
        rows = conn.execute(sql, params).mappings().all()

    ad = [[],[]]
    for r in rows:
        time = to_unix_seconds(r["t"])
        ad[0].append(time)
        ad[1].append(r["price"])

    if len(ad[0]) == 0:
        ad = None
        
    return {"alignedData":ad}


@app.post("/prices", response_model=AlignedData)
def prices(base_params:BaseParams):
    aligned_data_price_series = getPrices(base_params)
    return aligned_data_price_series

MinutesInYear = 525600

GQL_URL = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn"

QUERY = """
query MarketVolume($marketID: ID!) {
  orderbook(id: $marketID) {
    volume: scaledCollateralVolume
  }
}
"""

def fetch_market_volume(market_id: str) -> Decimal | None:
    """
    Returns the scaledCollateralVolume for a given market_id as Decimal.
    If the orderbook isn't found, returns None.
    """

    payload = {
        "query": QUERY,
        "variables": {"marketID": market_id}
    }

    resp = requests.post(GQL_URL, json=payload)
    resp.raise_for_status()
    data = resp.json()

    ob = data.get("data", {}).get("orderbook")
    if ob is None or ob.get("volume") is None:
        return None

    # Many subgraphs ship large numbers as strings. Convert safely.
    return Decimal(str(ob["volume"]))

class statsInput(BaseModel):
    base_params : BaseParams
    features: list[str] = []
    sma_window: int | None = None
    macd_fast: int | None = None
    macd_slow: int | None = None
    vol_window: int | None = None
    trend_degree: int | None = None

class statsSummary(BaseModel):
    mean: float
    min: float
    max: float
    stdex: float

class statsResponse(BaseModel):
    macdHistData : List[List[float]] | None = None
    macdSigMacdData : List[List[float]] | None = None
    smaData: List[List[float]] | None = None
    trendData: List[List[float]] | None = None
    volatility: float | None = None
    volume: float | None = None
    stats: statsSummary | None = None

def nan_indices(lst):
    # catches float('nan') and numpy.nan if they’re floats in the list
    return [i for i, x in enumerate(lst) if isinstance(x, float) and math.isnan(x)]

@app.post("/stats", response_model = statsResponse)
def get_stats(
    req: statsInput
):
    features = set(req.features)
    volatility = None
    volume = None
    stats = None
    sma_data = None
    trend_data = None
    macd_hist_data = None
    macd_sig_macd_data = None

    ps = getPrices(req.base_params)["alignedData"]
    times = ps[0]
    prices = ps[1]
    ptDataFrame = pd.DataFrame({"t": times, "p": prices})
    ptDataFrame = ptDataFrame.sort_values("t")
    ptDataFrame.set_index("t")
    ptDataFrame['p'] = pd.to_numeric(ptDataFrame["p"], errors="coerce").astype("float64")

    if "sma" in features and req.sma_window:
        ptDataFrame['rolling'] = ptDataFrame.rolling(req.sma_window, on='t', min_periods=1)['p'].mean()

        rolling_list = ptDataFrame['rolling'].to_list()
        times_list = ptDataFrame["t"].to_list()
        times_list = times_list[len(times_list)-len(rolling_list):]
        ad_sma = []
        ad_sma.append(times_list)
        ad_sma.append(rolling_list)
        sma_data = ad_sma

    if "trend" in features and req.trend_degree:
        times = ptDataFrame["t"]
        prices = ptDataFrame["p"]

        p = Polynomial.fit(times, prices, req.trend_degree)   # returns [a4, a3, a2, a1, a0]            # prediction function
        y_hat = p(times)
        
        ad_trend = []
        ad_trend.append(times.to_list())
        ad_trend.append(y_hat.tolist())
        trend_data = ad_trend

    if "macd" in features and req.macd_fast and req.macd_slow and req.macd_slow > req.macd_fast:
        ema = lambda s, n: s.ewm(span=(n), adjust=False, min_periods=(n)).mean()

        ptDataFrame["ema_fast"] = ema(ptDataFrame["p"], req.macd_fast*60)
        ptDataFrame["ema_slow"] = ema(ptDataFrame["p"], req.macd_slow*60)

        signal_period = 9
        # 3) MACD components
        ptDataFrame["macd"] = ptDataFrame["ema_fast"] - ptDataFrame["ema_slow"]
        ptDataFrame["signal"] = ptDataFrame["macd"].ewm(span=signal_period, adjust=False, min_periods=signal_period).mean()
        ptDataFrame["histogram"] = ptDataFrame["macd"] - ptDataFrame["signal"]
        ptDataFrame["signal_pct"] = (ptDataFrame["signal"] / ptDataFrame["p"]) * 100.0 
        ptDataFrame["macd_pct"] = (ptDataFrame["macd"]/ ptDataFrame["p"]) * 100.0   # percent MACD
        ptDataFrame["hist_pct"] = (ptDataFrame["histogram"]/ ptDataFrame["p"]) * 100.0

        signal_list = ptDataFrame["signal_pct"].dropna().to_list()
        ls = len(signal_list)

        hist_list = ptDataFrame["hist_pct"].dropna().to_list()
        hist_list = hist_list[len(hist_list)-ls:]

        macd_list = ptDataFrame["macd_pct"].dropna().to_list()
        macd_list = macd_list[len(signal_list)-ls:]

        time_list = ptDataFrame["t"].tolist()
        time_list = time_list[len(time_list)-ls:]
        
        macd_hist_data = []
        macd_hist_data.append(time_list)
        macd_hist_data.append(hist_list)

        macd_sig_macd_data = []
        macd_sig_macd_data.append(time_list)
        macd_sig_macd_data.append(macd_list)
        macd_sig_macd_data.append(signal_list)
        

    if "volatility" in features and req.vol_window:
        s = ptDataFrame["p"]
        r = np.log(s).diff(req.vol_window).dropna()
        std = r.std()
        volatility = (math.sqrt(MinutesInYear)/req.vol_window*std)*100

    if "volume" in features:
        volume = fetch_market_volume(req.base_params.nameID.marketID,)

    if "stats" in features:
        ps = ptDataFrame["p"]
        avg_p = ps.mean()      # average
        min_p = ps.min()      # minimum
        max_p = ps.max()       # maximu
        std_p = ps.std()       # standard deviation (sample, ddof=1)
        stats = {"mean":avg_p,"min":min_p,"max":max_p,"stdex":std_p}

    StatsResponseData = {"macdHistData":macd_hist_data, "macdSigMacdData":macd_sig_macd_data, "smaData":sma_data, "trendData":trend_data, 
                         "volatility":volatility, "volume":volume, "stats":stats}

    return StatsResponseData


def r2(df_series: pd.DataFrame, r2_window: int) -> list[float]:
    # log prices; non-positive -> NaN (so log(0/neg) doesn’t poison things)
    logp = np.log(df_series.where(df_series > 0))

    # windowed log returns
    ret = logp.diff(r2_window)

    # pairwise corr, then square
    r2m = ret.corr(min_periods=2) ** 2

    out = np.nan_to_num(r2m.to_numpy(dtype=float, copy=False), nan=0.0).ravel().tolist()
    
    return out

def hit_rate_percentages(
    prices: pd.DataFrame,
    period: int,
):
    chg = prices.diff(periods=period).dropna()

    rowmax = chg.max(axis=1)

    # mark winners (handle NaNs; ties allowed)
    is_top = chg.eq(rowmax, axis=0) & chg.notna()

    # split point among ties so each row sums to 1
    tie_counts = is_top.sum(axis=1).replace(0, pd.NA)
    shares = is_top.div(tie_counts, axis=0).fillna(0.0)

    # total score per asset; divide by number of scored rows to get a percentage
    denom = len(shares)
    out = (shares.sum(axis=0) / denom).sort_values(ascending=False)
    list_out = out.to_list()
    return list_out

def align_with_pandas(series: List[tuple[np.ndarray, np.ndarray]], how: str = "outer") -> pd.DataFrame:
    """
    series: list of (times, prices), each 1-D arrays of equal length per pair.
    how: 'outer' (union), 'inner' (intersection), 'left'/'right' if you enjoy asymmetry.
    Returns: [times, p0, p1, ...] where times and prices are numpy arrays.
    """
    dfs = []
    for i, (t, p) in enumerate(series):
        df = (
            pd.DataFrame({"time": t, f"p{i}": p})
              .drop_duplicates("time", keep="last")  # dedup within this series
              .set_index("time")
        )
        dfs.append(df)

    aligned = pd.concat(dfs, axis=1, join=how).sort_index()

    return aligned

class CompareRequest(BaseModel):
    sources: List[BaseParams]
    features: List[str] = []
    r2_window: Optional[int] = None
    hit_rate_window: Optional[int] = None

class CompareResponse(BaseModel):
    rsquared: list[float] | None = None      # flat row-major, len == n*n
    lines: List[List[float|None]] | None = None   # [[t],[p1],[p2],...]
    hitr: List[List[float|str]]| None = None
    marketNames: List[str]

@app.post("/compare", response_model=CompareResponse)
def post_compare(req: CompareRequest):
    # Access like a normal adult:
    sources = req.sources
    features = set(req.features)
    r2_window = req.r2_window
    hit_win = req.hit_rate_window
    compare_results = {"rsquared":None,"lines":None,"hitr":None, "marketNames":None}

    market_name_list = []
    end_list = []
    start_list = []

    for response in sources:
        market_name_list.append(response.nameID.marketName) 
        end_list.append(to_unix_seconds(response.end))
        start_list.append(to_unix_seconds(response.start))

    start = max(start_list)
    end = min(end_list)

    start = datetime.fromtimestamp(start)
    end = datetime.fromtimestamp(end)

    ad_list = []
    for base in sources:
        base.fidelity = 1
        ad = getPrices(base)["alignedData"]
        time = np.array(ad[0])
        price = np.array(ad[1])
        ad_list.append((time,price))

    aligned = align_with_pandas(ad_list)
    aligned.dropna(inplace=True)

    if "r2" in features and r2_window:
        rsquared = r2(aligned, r2_window)
        compare_results["rsquared"] = rsquared

    if "lines" in features:
        times = aligned.index.tolist()                    # times won’t be NaN
        prices = [aligned[c].tolist() for c in aligned.columns]  # now contains None, not NaN
        lines = [times] + prices
        compare_results["lines"] = lines

    if "hit_rate" in features and hit_win:
        rates = hit_rate_percentages(aligned,hit_win)
        hitr = []
        hitr.append(market_name_list)
        hitr.append(rates)
        compare_results["hitr"] = hitr
    compare_results["marketNames"] = market_name_list
    return compare_results
