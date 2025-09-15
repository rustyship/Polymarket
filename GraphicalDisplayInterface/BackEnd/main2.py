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

#defines classes for data output
class PricePoint(BaseModel):
    t: float  # unix time
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

def assert_matches(model: type[BaseModel], data) -> None:
    """
    Validate `data` against `model`.
    Raises ValidationError after printing precise, readable error locations.
    """
    try:
        model.model_validate(data)
    except ValidationError as e:
        print("Schema mismatches:")
        for i, err in enumerate(e.errors(), 1):
            path = " -> ".join(map(str, err["loc"]))
            print(f"{i}. at {path}: {err['msg']}  [type={err['type']}]")
        raise  # keep stack behavior for callers/tests




@app.get("/markets/names", response_model=List[nameIdPair])
def get_market_options(limit: int = 50, offset: int = 0, top_k: int = 50):
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
    with engine.begin() as conn:
        rows = conn.execute(sql, params).mappings().all()

    marketName = base_param.nameID.marketName

    points = []
    for r in rows:
        time = to_unix_seconds(r["t"])
        pp = {"t":time, "p":r["price"]}
        points.append(pp)
    
    ps = {"name":marketName,"points":points}
    return ps

class pricesResponse(BaseModel):
  base: BaseParams
  series: PriceSeries

@app.post("/prices", response_model=pricesResponse)
def prices(base_params:BaseParams):
    price_series = getPrices(base_params)
    api_response_get_market = {"base":base_params, "series":price_series}
    return api_response_get_market



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
    base: BaseParams
    macdf: PriceSeries | None = None
    macds: PriceSeries | None = None
    series: List[PriceSeries] = None
    volatility: float | None = None
    volume: float | None = None
    stats: statsSummary | None = None

@app.post("/stats", response_model = statsResponse)
def get_stats(
    req: statsInput
):
    features = set(req.features)

    start = req.base_params.start
    end = req.base_params.end

    volatility = None
    volume = None
    list_p_series = []
    stats = None
    macd_fast_series = None
    macd_slow_series = None

    ps = getPrices(req.base_params)["points"]
    ptDataFrame = pd.DataFrame(ps, columns=["t","p"])
    ptDataFrame = ptDataFrame.sort_values("t")
    ptDataFrame['p'] = pd.to_numeric(ptDataFrame["p"], errors="coerce").astype("float64")

    if "sma" in features and req.sma_window:
        ptDataFrame['rolling'] = ptDataFrame.rolling(req.sma_window, on='t', min_periods=1)['p'].mean()
        points = ptDataFrame[["t", "rolling"]].rename(columns={"rolling": "p"}).to_dict("records")
        smapSeries = {"name":"sma","points":points}
        list_p_series.append(smapSeries)

    if "trend" in features and req.trend_degree:
        times = ptDataFrame["t"]
        prices = ptDataFrame["p"]

        p = Polynomial.fit(times, prices, req.trend_degree)   # returns [a4, a3, a2, a1, a0]            # prediction function
        y_hat = p(times)

        trend = [{"t": t, "p": round(float(v), 12)} for t, v in zip(times, y_hat)]
        tred_p_series = {"name":"price_tren","points":trend}
        list_p_series.append(tred_p_series)


    if "macd" in features and req.macd_fast and req.macd_slow and req.macd_slow > req.macd_fast:

        ptDataFrame['macd_fast'] = ptDataFrame.rolling(req.macd_fast, on='t', min_periods=req.macd_fast)["p"].mean()
        ptDataFrame["macd_slow"] = ptDataFrame.rolling(req.macd_slow, on='t', min_periods=req.macd_slow)["p"].mean()
        
        aligned = ptDataFrame.loc[ptDataFrame["macd_slow"].notna(), ["t", 'macd_fast', "macd_slow"]].copy()

        points_fast =  aligned[["t", "macd_fast"]].rename(columns={"macd_fast": "p"}).to_dict("records")
        points_slow =  aligned[["t", "macd_slow"]].rename(columns={"macd_slow": "p"}).to_dict("records")

        macd_fast_series = {"name":"macd_fast","points":points_fast}
        macd_slow_series = {"name":"macd_slow","points":points_slow}


    if "volatility" in features and req.vol_window:
        s = ptDataFrame["p"]
        r = np.log(s).diff(req.vol_window).dropna()
        std = r.std()
        volatility = math.sqrt(MinutesInYear)/req.vol_window*std

    if "volume" in features:
        volume = fetch_market_volume(req.base_params.nameID.marketID,)

    if "stats" in features:
        ps = ptDataFrame["p"]
        avg_p = ps.mean()      # average
        min_p = ps.min()      # minimum
        max_p = ps.max()       # maximu
        std_p = ps.std()       # standard deviation (sample, ddof=1)
        stats = {"mean":avg_p,"min":min_p,"max":max_p,"stdex":std_p}

    StatsResponseData = {"base":req.base_params, "macdf": macd_fast_series, "macds":macd_slow_series, "series":list_p_series,"volatility":volatility, "volume":volume, "stats":stats}

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
    return out.to_dict()

def getPricesCompare(name_id:nameIdPair,start,end):

    market_id = name_id.marketID

    sql = text("""SELECT t, price
                FROM analytics_2_0.market_prices
                WHERE market_id = :market_id
                AND t >= :start AND t < :end
                AND EXTRACT(SECOND FROM t) = 0
                AND (EXTRACT(MINUTE FROM t)::int % :fidelity) = 0
                ORDER BY t;""")
    
    params = {"market_id": market_id, "start": start, "end": end, "fidelity": "1"}
    with engine.begin() as conn:
        rows = conn.execute(sql, params).mappings().all()

    marketName = name_id.marketName

    points = []
    for r in rows:
        time = to_unix_seconds(r["t"])
        pp = {"t":time, "p":r["price"]}
        points.append(pp)
    
    ps = {"name":marketName,"points":points}
    return ps


class CompareRequest(BaseModel):
    sources: List[BaseParams]
    features: List[str] = []
    r2_window: Optional[int] = None
    hit_rate_window: Optional[int] = None

class CompareResponse(BaseModel):
    rsquared: list[float] | None = None      # flat row-major, len == n*n
    lines: list[list[float]] | None = None   # [[t],[p1],[p2],...]
    hitr: dict[str, float] | None = None

@app.post("/compare", response_model=CompareResponse)
def post_compare(req: CompareRequest):
    # Access like a normal adult:
    sources = req.sources
    features = set(req.features)
    r2_window = req.r2_window
    hit_win = req.hit_rate_window
    compare_results = {"rsquared":None,"lines":None,"hitr":None}

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

    price_list = []
    for response in sources:
        temp_price_list = []
        prices = getPricesCompare(response.nameID,start,end)
        if len(price_list) == 0:
            temp_time_list = []
            for tp in prices["points"]:     
                temp_time_list.append(float(tp["t"]))
            price_list.append(temp_time_list)
        for tp in prices["points"]:
            temp_price_list.append(float(tp["p"]))
        price_list.append(temp_price_list)
    #current structure of price list is [[time][price1][price2]...]

    names = [f"p{i+1}" for i in range(len(market_name_list))]
    data = {"t": price_list[0]}
    for name, pl in zip(names, price_list[1:]):
        data[name] = pl
    df_series = pd.DataFrame(data).set_index("t")
    
    if "r2" in features and r2_window:
        rsquared = r2(df_series, r2_window)
        compare_results["rsquared"] = rsquared

    if "lines" in features:
       compare_results["lines"] = price_list

    if "hit_rate" in features and hit_win:
        hitr = hit_rate_percentages(df_series,hit_win)
        print(hitr)
        compare_results["hitr"] = hitr


    return compare_results
