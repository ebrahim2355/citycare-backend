const AREA_CENTERS: Record<string, [number, number]> = {
    Badda: [23.7806, 90.4253],
    Banani: [23.7937, 90.4066],
    Bashundhara: [23.8155, 90.433],
    Dhanmondi: [23.7461, 90.3742],
    Farmgate: [23.7577, 90.3896],
    Gulshan: [23.7925, 90.414],
    Jatrabari: [23.7104, 90.4347],
    Khilgaon: [23.7518, 90.425],
    Lalbagh: [23.7189, 90.3882],
    Malibagh: [23.7499, 90.4127],
    Mirpur: [23.8069, 90.3687],
    Mohammadpur: [23.7662, 90.3589],
    Motijheel: [23.733, 90.4172],
    Rampura: [23.7612, 90.421],
    Shyamoli: [23.7745, 90.3657],
    Tejgaon: [23.7637, 90.399],
    Uttara: [23.8759, 90.3795],
    Wari: [23.7186, 90.4185],
};

const DHAKA_CENTER: [number, number] = [23.7808, 90.4093];

const hash = (text: string) => {
    let value = 2166136261;

    for (const char of text) {
        value ^= char.charCodeAt(0);
        value = Math.imul(value, 16777619);
    }

    return value >>> 0;
};

export const pointNear = (area: string, key: string) => {
    const [latitude, longitude] = AREA_CENTERS[area] ?? DHAKA_CENTER;
    const seed = hash(`${area}:${key}`);
    const angle = ((seed % 360) * Math.PI) / 180;
    const meters = 150 + ((seed >>> 9) % 650);
    const dLat = (meters * Math.cos(angle)) / 111320;
    const dLng = (meters * Math.sin(angle)) / (111320 * Math.cos((latitude * Math.PI) / 180));

    return { latitude: Number((latitude + dLat).toFixed(6)), longitude: Number((longitude + dLng).toFixed(6)) };
};
