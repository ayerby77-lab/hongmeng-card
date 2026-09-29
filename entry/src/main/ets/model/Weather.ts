export interface ForecastDay {
  date: string;
  min: number;
  max: number;
  code: number;
  rainProbability: number;
}

export interface WeatherReport {
  time: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  code: number;
  days: ForecastDay[];
}

interface CurrentWeather {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  weather_code: number;
}

interface DailyWeather {
  time: string[];
  temperature_2m_min: number[];
  temperature_2m_max: number[];
  weather_code: number[];
  precipitation_probability_max: number[];
}

interface WeatherPayload {
  current: CurrentWeather;
  daily: DailyWeather;
}

function validNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseWeather(json: string): WeatherReport {
  const payload: WeatherPayload = JSON.parse(json) as WeatherPayload;
  if (!payload || !payload.current || !payload.daily) {
    throw new Error('天气数据不完整，请重试');
  }
  const current: CurrentWeather = payload.current;
  const daily: DailyWeather = payload.daily;
  if (typeof current.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(current.time) ||
    !validNumber(current.temperature_2m) || !validNumber(current.relative_humidity_2m) ||
    current.relative_humidity_2m < 0 || current.relative_humidity_2m > 100 ||
    !validNumber(current.wind_speed_10m) || current.wind_speed_10m < 0 ||
    !validNumber(current.wind_direction_10m) || current.wind_direction_10m < 0 || current.wind_direction_10m > 360 ||
    !validNumber(current.weather_code) || !Array.isArray(daily.time) || daily.time.length !== 7 ||
    !Array.isArray(daily.temperature_2m_min) || daily.temperature_2m_min.length !== 7 ||
    !Array.isArray(daily.temperature_2m_max) || daily.temperature_2m_max.length !== 7 ||
    !Array.isArray(daily.weather_code) || daily.weather_code.length !== 7 ||
    !Array.isArray(daily.precipitation_probability_max) || daily.precipitation_probability_max.length !== 7) {
    throw new Error('天气数据不完整，请重试');
  }
  const days: ForecastDay[] = [];
  for (let i: number = 0; i < 7; i++) {
    const min: number = daily.temperature_2m_min[i];
    const max: number = daily.temperature_2m_max[i];
    const rain: number = daily.precipitation_probability_max[i];
    if (typeof daily.time[i] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(daily.time[i]) ||
      !validNumber(min) || !validNumber(max) || min > max || !validNumber(daily.weather_code[i]) ||
      !validNumber(rain) || rain < 0 || rain > 100) {
      throw new Error('天气预报数据不完整，请重试');
    }
    days.push({ date: daily.time[i], min: min, max: max, code: daily.weather_code[i], rainProbability: rain });
  }
  return { time: current.time, temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m, windSpeed: current.wind_speed_10m,
    windDirection: current.wind_direction_10m, code: current.weather_code, days: days };
}

export function weatherText(code: number): string {
  switch (code) {
    case 0: return '晴';
    case 1: return '晴间多云';
    case 2: return '多云';
    case 3: return '阴';
    case 45: case 48: return '雾';
    case 51: case 53: case 55: return '毛毛雨';
    case 56: case 57: case 66: case 67: return '冻雨';
    case 61: return '小雨';
    case 63: return '中雨';
    case 65: return '大雨';
    case 71: return '小雪';
    case 73: return '中雪';
    case 75: return '大雪';
    case 77: return '雪粒';
    case 80: case 81: case 82: return '阵雨';
    case 85: case 86: return '阵雪';
    case 95: return '雷雨';
    case 96: case 99: return '雷雨伴冰雹';
    default: return '天气未知';
  }
}

// Beaufort thresholds in km/h; the service explicitly requests km/h.
export function windLevel(speed: number): number {
  const thresholds: number[] = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  for (let i: number = 0; i < thresholds.length; i++) {
    if (speed < thresholds[i]) {
      return i;
    }
  }
  return 12;
}
