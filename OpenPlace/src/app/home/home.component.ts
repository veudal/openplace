import { Component, OnInit, isDevMode } from '@angular/core';
import Pickr from '@simonwep/pickr';
import { Pixel } from '../models/Pixel.model';
import { HoverPixel } from '../models/HoverPixel';
import { environment } from '../../environments/environment';
import { BoardSize } from '../interfaces/BoardSize.interface';
import { Leaderboard } from '../interfaces/Leaderboard.interface';
import { SignalRService } from '../services/signalr.service';
import { ViewSettings } from '../interfaces/ViewSettings.interface';
import { HubConnectionState } from '@microsoft/signalr';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NgxSliderModule } from '@angular-slider/ngx-slider';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterOutlet, CommonModule, RouterLink, NgxSliderModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})

export class HomeComponent implements OnInit {
  title: string = 'Open Place';

  colorPalette: string[] = ['000000', 'FFFFFF', 'B9C3CF', '777F8C', '424651', '1F1E26', '000000', '382215', '7C3F20', 'C06F37', 'FEAD6C', 'FFD2B1', 'FFA4D0',
    'F14FB4', 'E973FF', 'A630D2', '531D8C', '242367', '0334BF', '149CFF', '8DF5FF', '01BFA5', '16777E', '054523', '18862F',
    '61E021', 'B1FF37', 'FFFFA5', 'FDE111', 'FF9F17', 'F66E08', '550022', '99011A', 'F30F0C', 'FF7872'];

  defaultColor: string = "FFFFFF";
  defaultUsername: string = "Anonymous";
  username: string = this.defaultUsername;

  timeoutId: number | null = null;

  audio: HTMLAudioElement = new Audio("assets/sfx/place.mp3");
  pickr: Pickr | null = null;

  hoverPixel: HoverPixel = new HoverPixel(-1, -1, "", "");
  boardArr: Pixel[] = [];
  userFilter: string | null = null;
  pixelQueue: Pixel[] = [];
  dimensions: BoardSize = { width: environment.boardWidth, height: environment.boardHeight };
  panzoom: PanzoomObject = null!;
  leaderboard: Leaderboard[] = [];

  selectedColor: number = 0;

  debounceTimeout: any = null;
  sliderValue = 0;
  sliderDragState = false;
  isSliderVisible = false; //Has to be false until board has been loaded
  sliderOptions = {
    ceil: 0,
    vertical: true,
    showSelectionBar: true,
    rightToLeft: true,
    selectionBarGradient: {
      from: 'skyblue',
      to: '#8048fa'
    },
    getPointerColor: () => {
      return '#8048fa';
    },
    translate: (value: number): string => {
      if (value == 0) {
        return `
      <div style="text-align: center; color: #8048fa; font-size: 14px">
        <b># ${value} Pixel
      </div>`;
      }

      const p = this.boardArr[Math.max(value - 1, 0)];
      return `
      <div style="text-align: center; color: #8048fa; font-size: 14px">
        <b># ${value} Pixel
        </b><br>${this.getLocalDate(p.timestamp)}
        </b><br>(${p.x} | ${p.y})
    </div>`;
    }
  };

  grid: any;

  canvas: any;
  context: any;


  constructor(private signalRService: SignalRService, private router: Router, private route: ActivatedRoute) { }

  ngOnInit() {
    this.initCanvas();
    this.initUsername();
    this.initPanzoom();
    this.initCanvasEvents();
    this.initWindowResizeEvent();
    this.initSignalR();
    this.initDocumentEvents();
    this.initPaletteContainer();
    this.initColorPicker();


  }

  private initUsername() {
    const storedUsername = localStorage.getItem("username");
    if (storedUsername) {
      this.username = storedUsername;
    }
  }

  private initPanzoom() {
    this.updateZoompanFromParams();
    this.panzoom = Panzoom(document.getElementById("canvasDiv")!, {
      contain: 'outside',
      cursor: 'pointer',
      step: 0.7,
      minScale: 1,
      maxScale: Math.min(this.dimensions.width, this.dimensions.height) / 10
    });
    this.restorePanzoomState();
  }

  private initColorPicker() {
    this.pickr = Pickr.create({
      el: '.color-picker',
      theme: 'monolith',
      useAsButton: true,
      position: "bottom-start",
      autoReposition: true,
      default: this.colorPalette[0],
      swatches: this.colorPalette.slice(2),
      lockOpacity: true,

      components: {

        preview: true,
        opacity: false,
        hue: true,

        interaction: {
          hex: true,
          rgba: true,
          cancel: false,
          input: true,
          clear: false,
          save: false
        }
      }
    });

    this.pickr.on("hide", () => {
      this.pickr?.applyColor();
    })

    this.pickr.on('change', (color: any) => {
      const hexa = color.toHEXA();
      const c = hexa[0] + hexa[1] + hexa[2];
      this.updatePaletteSelection(c);
    });
  }

  private async initCanvas() {

    // Initialize canvas
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.canvas.width = this.dimensions.width;
    this.canvas.height = this.dimensions.height;

    this.context = this.canvas.getContext("2d");
    this.canvas.setAttribute('tabindex', '0');

    this.grid = document.getElementById('grid') as HTMLDivElement;

    await this.loadBoard();
  }

  private updateZoompanFromParams() {
    let { x, y, scale } = this.route.snapshot.queryParams;

    if (x && y && scale) {
      localStorage.setItem('panzoomState', JSON.stringify({ x: x || 0, y: y || 0, scale: scale || 1 }));
    }
    else {
      const stored: ViewSettings = JSON.parse(localStorage.getItem("panzoomState") || "{}");
      ({ x, y, scale } = stored);
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { x: x, y: y, scale: scale },
    });
  }

  private initCanvasEvents() {
    this.resizeCanvas();
    this.canvas.addEventListener('wheel', this.onWheel.bind(this));
    this.canvas.addEventListener('keydown', (e: KeyboardEvent) => this.handleMovement(e));
    this.canvas.addEventListener('pointerdown', (e: MouseEvent) => this.handleMouseDown(e));
    this.canvas.addEventListener('pointerup', (e: MouseEvent) => this.handleMouseUp(e));
    this.canvas.addEventListener("pointermove", this.onHover.bind(this));
    this.canvas.addEventListener("pointerleave", this.onLeave.bind(this));
    this.canvas.addEventListener('pointerover', () => this.handleMouseOver());
  }

  private handleMouseOver() {
    if (!this.sliderDragState && !this.pickr?.isOpen()) {
      this.canvas.focus()
    }
  }

  private initPaletteContainer() {
    const storedColor = localStorage.getItem("customColor");
    if (storedColor !== null) {
      this.colorPalette[0] = storedColor;
    }

    const paletteContainer = document.getElementById('palette-container');
    if (!paletteContainer) return;

    this.colorPalette.forEach((color, i) => {
      const colorDiv = document.createElement('div') as HTMLDivElement;
      colorDiv.style.width = '35px';
      colorDiv.style.height = '35px';
      colorDiv.style.backgroundColor = `#${color}`;
      colorDiv.style.borderRadius = '20%';
      colorDiv.style.cursor = 'pointer';
      colorDiv.style.transition = 'transform 0.2s ease';
      colorDiv.style.border = '2px solid #ffffff';
      colorDiv.style.display = 'inline-block';
      colorDiv.id = i.toString() + "-color";

      if (i == this.selectedColor) {
        colorDiv.style.transform = 'scale(1.3)';
        colorDiv.style.border = '3px solid #0080FF';
      }

      colorDiv.addEventListener('click', () => this.handleColorDivClick(colorDiv));
      colorDiv.addEventListener('mouseover', () => colorDiv.style.transform = 'scale(1.3)');
      colorDiv.addEventListener('mouseout', () => colorDiv.style.transform = 'scale(1)');

      paletteContainer.appendChild(colorDiv);
    });
  }

  private handleColorDivClick(colorDiv: HTMLDivElement) {
    const index = parseInt(colorDiv.id.substring(0, colorDiv.id.indexOf('-')));
    this.updatePaletteSelection(null, index);

    if (this.selectedColor == 0) {
      this.pickr?.show();
    }
  }

  private initWindowResizeEvent() {
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });
  }

  private initSignalR() {

    this.signalRService.startConnection().subscribe(() => {
      this.signalRService.receiveMessage().subscribe((message: any) => {

        const obj = JSON.parse(message);
        if (obj.type == "Broadcast") {
          if (obj.username.toLowerCase() == this.username.toLowerCase()) {
            alert("Admin: " + obj.info)
          }
        }
        else {
          this.receivePixel(obj);
        }
      });
    });
  }

  private receivePixel(receivedPixel: any) {
    if (receivedPixel.placedBy == "") {
      receivedPixel.placedBy = this.defaultUsername;
    }

    this.boardArr.push(receivedPixel);

    const isLastPixel = this.sliderValue + 1 == this.boardArr.length;

    if (this.isSliderVisible && isLastPixel && this.userFilter == null) {
      this.setSliderToMax();
    }
    else {
      this.sliderOptions = {
        ...this.sliderOptions,
        ceil: this.boardArr.length
      };
    }
    if (isLastPixel && !this.userFilter || this.userFilter == receivedPixel.placedBy) {
      this.drawPixel(receivedPixel.x, receivedPixel.y, receivedPixel.color);
    }

    this.updateLeaderboard();
  }

  private initDocumentEvents() {
    document.addEventListener('wheel', (e: WheelEvent) => this.handleColorScrolling(e), { passive: false });
    document.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeydown(e));
    document.addEventListener("contextmenu", (e: Event) => e.preventDefault());

    document.addEventListener('selectionchange', () => {
      if (document.activeElement?.id == "canvas") {
        window.getSelection()!.removeAllRanges();
      }
    });

    document.addEventListener('pointerup', (e: MouseEvent) => {
      if (e.button == 2) {
        this.savePanzoomState();
      }
    });
  }

  private handleColorScrolling(e: WheelEvent) {
    e.preventDefault()
    const id = (e.target as HTMLElement).id
    if (e.shiftKey || e.ctrlKey || e.altKey || id == "palette-container" || id.endsWith("-color")) {
      if (e.deltaY > 0) {
        this.setSelectedColor("E");
      }
      else {
        this.setSelectedColor("Q");
      }
    }
  }

  private handleMouseUp(e: MouseEvent) {

    if (e.button == 1 || e.button == 2) {
      const pan = this.panzoom.getPan();
      const stored: ViewSettings = JSON.parse(localStorage.getItem("panzoomState") || "{}");

      const tolerance = 1; //Adjustment may be needed

      const xMatch = Math.abs(Math.round(pan.x) - stored.x) <= tolerance;
      const yMatch = Math.abs(Math.round(pan.y) - stored.y) <= tolerance;
      if (xMatch && yMatch) {
        this.colorPicker(e);
      }
    }
    else if (e.button == 0) {
      this.setPixel(e);
    }
  }

  private handleMouseDown(e: MouseEvent) {
    this.panzoom.setOptions({ disablePan: e.button != 2 });
    this.pickr?.hide();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.pickr?.isOpen()) {
      return;
    }
    this.setSelectedColor(e.key.toUpperCase());

    if (e.code.startsWith("Digit")) {
      const key = e.code.slice(5);
      let index = 9;
      if (key != '0') {
        index = parseInt(key) - 1;
      }
      if (this.userFilter == this.leaderboard[index].name) {
        this.resetUserFilter();
        return;
      }
      this.userFilter = this.leaderboard[index].name;
      this.updateLeaderboard();
      this.drawBoard();
      this.hoverPixel = this.findLatestPixel(this.hoverPixel.x, this.hoverPixel.y) || new HoverPixel(-1, -1, "", "");
    }
    else if (e.key == "Escape") {

      this.resetUserFilterAndHistoryMode();
    }
    else if (e.key == "+") {
      this.panzoom.zoomIn();
      this.savePanzoomState();
    }
    else if (e.key == "-") {
      this.panzoom.zoomOut();
      this.savePanzoomState();
    }
    else if (e.key.toUpperCase() == "G") {
      if (this.grid.style.opacity == 0) {
        this.grid.style.opacity = 1;
      }
      else {
        this.grid.style.opacity = 0;
      }
    }
  }

  private setSelectedColor(key: string) {
    let index = this.selectedColor;
    if (key == " ") {
      index = 0;
    }
    else if (key == "Q") {
      index = Math.max(0, this.selectedColor - 1);
    }
    else if (key == "E") {
      index = Math.min(this.colorPalette.length - 1, this.selectedColor + 1);
    }
    else {
      return;
    }

    this.updatePaletteSelection(null, index);
    this.drawHoverPixel(this.hoverPixel?.x ?? 0, this.hoverPixel?.y ?? 0, this.hoverPixel?.color ?? this.defaultColor, this.hoverPixel.placedBy, true);
    this.pickr?.hide();
  }

  private resetUserFilter() {
    this.userFilter = null;
    this.updateLeaderboard();
    this.drawBoard();
    this.hoverPixel = this.findLatestPixel(this.hoverPixel.x, this.hoverPixel.y) || new HoverPixel(-1, -1, "", "");
  }

  private updatePaletteSelection(c: string | null, index: number | null = null) {

    const old = document.getElementById(this.selectedColor.toString() + "-color")!;
    old.style.border = '2px solid #ffffff';
    old.style.transform = 'scale(1.0)';

    if (c) {
      c = c.toUpperCase();
      this.selectedColor = Math.max(this.colorPalette.lastIndexOf(c), 0);
    }
    else if (index != null) {
      this.selectedColor = index;
    }

    const colorDiv = document.getElementById(this.selectedColor.toString() + "-color")!;
    colorDiv.style.border = '3px solid #0080FF';
    colorDiv.style.transform = 'scale(1.3)';

    if (this.selectedColor == 0) {
      if (c) {
        this.colorPalette[0] = c.toUpperCase();
      }
      else if (index) {
        this.colorPalette[0] = this.colorPalette[index]
      }
      colorDiv.style.backgroundColor = "#" + c;
      localStorage.setItem("customColor", this.colorPalette[0]);
    }
  }

  private colorPicker(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = this.calculateXPosition(e.clientX, rect);
    const y = this.calculateYPosition(e.clientY, rect);
    let pixel = this.findLatestPixel(x, y);
    if (!pixel) {
      if (x < this.dimensions.width && y < this.dimensions.height) {
        pixel = new Pixel(x, y, this.defaultColor, "", "");
      }
      else {
        return;
      }
    }
    this.updatePaletteSelection(pixel.color);
    if (this.selectedColor == 0) {
      this.pickr?.setColor("#" + pixel.color);
    }
    this.drawHoverPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel?.color ?? this.defaultColor, this.hoverPixel.placedBy, true);
  }
  private handleMovement(e: KeyboardEvent) {
    e.preventDefault();
    switch (e.key.toLocaleLowerCase()) {
      case "w":
      case "arrowup":
        this.move(0, 1);
        break;

      case "a":
      case "arrowleft":
        this.move(1, 0);
        break;

      case "s":
      case "arrowdown":
        this.move(0, -1);
        break;

      case "d":
      case "arrowright":
        this.move(-1, 0);
        break;
    }
  }

  private move(deltaX: number, deltaY: number) {

    const pan = this.panzoom.getPan();
    const zoom = this.panzoom.getScale();

    const panX = pan.x + deltaX * this.canvas.clientWidth / (zoom * 2);
    const panY = pan.y + deltaY * this.canvas.clientHeight / (zoom * 2);

    this.panzoom.pan(panX, panY, { animate: true, force: true });

    const pixel = this.findLatestPixel(this.hoverPixel.x, this.hoverPixel.y);
    if (pixel) {
      this.drawPixel(pixel.x, pixel.y, pixel.color);
    }
    this.savePanzoomState();
  }

  private resetUserFilterAndHistoryMode() {

    this.setSliderToMax();
    this.sliderValue = this.sliderOptions.ceil; //Required because drawBoard will be exectued before setSliderToMax due to setTimeout otherwise slider would glitch

    this.resetUserFilter();
  }

  private setPixel(e: MouseEvent) {
    if (!this.sliderDragState && (this.sliderValue != this.sliderOptions.ceil || this.userFilter != null)) {
      this.resetUserFilterAndHistoryMode();
      //Exit history mode
      return;
    }


    const rect = this.canvas.getBoundingClientRect();
    const x = this.calculateXPosition(e.clientX, rect);
    const y = this.calculateYPosition(e.clientY, rect);
    const pixel = this.getValidPixelOrNull(x, y, this.colorPalette[this.selectedColor], this.username, new Date());

    if (pixel) {
      this.hoverPixel = pixel;
      this.drawPixel(pixel.x, pixel.y, pixel.color);
      this.sendPixel(pixel.x, pixel.y, pixel.color, e);
    }
  }

  private increaseCounter() {
    const storedVal = localStorage.getItem("placedPixels");
    let count = 1;
    if (storedVal) {
      count = parseInt(storedVal,) + 1;
    }
    localStorage.setItem("placedPixels", count.toString());
  }


  private async playSound() {
    if (!this.audio.paused) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.audio.play();
  }

  onHover(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = this.calculateXPosition(e.clientX, rect);
    const y = this.calculateYPosition(e.clientY, rect);
    const pixel = this.findLatestPixel(x, y);

    this.drawHoverPixel(x, y, pixel?.color, pixel?.placedBy, false);

    if (pixel) {
      if (this.userFilter && this.userFilter != pixel.placedBy) {
        return;
      }
      const text = `(${pixel.x}, ${pixel.y}) ${pixel.placedBy || this.defaultUsername}<br/>${this.getLocalDate(pixel.timestamp)}`;
      this.showBubble(text, e.clientX, e.clientY);
    }
    else {
      this.hideBubble();
    }
  }

  private getLocalDate(date: string) {
    const options: Intl.DateTimeFormatOptions = {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    };

    const userLocale = navigator.language || undefined;
    let localizedDate = new Date(date).toLocaleDateString('de-DE', options);

    if (userLocale?.startsWith('de') || userLocale?.startsWith('en-GB')) {
      localizedDate = localizedDate.replace(/\//g, '.');  //replaces / with . for german culture
    }
    return localizedDate;
  }

  private findLatestPixel(x: number, y: number) {
    let max = this.boardArr.length;
    if (this.isSliderVisible) {
      max = this.sliderValue;
    }
    for (let i = max - 1; i >= 0; i--) {
      const item = this.boardArr[i];
      if ((!this.userFilter || this.userFilter == item.placedBy) && item.x === x && item.y === y) {
        return item;
      }
    }
    return null;
  }


  private calculateXPosition(mouse: number, rect: any) {
    return Math.floor((mouse - rect.left) / rect.width * this.dimensions.width);
  }

  private calculateYPosition(mouse: number, rect: any) {
    return Math.floor((mouse - rect.top) / rect.height * this.dimensions.height);
  }

  private onLeave() {
    if (this.hoverPixel) {
      this.drawPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel.color);
      this.hoverPixel = new HoverPixel(-1, -1, "", "")
    }
    this.hideBubble();
  }

  private drawHoverPixel(x: number, y: number, color: any, username: any, force: boolean) {
    if (!this.hoverPixel) {
      this.hoverPixel = new HoverPixel(x, y, color || this.defaultColor, username);
    }
    else if (this.hoverPixel.x !== x || this.hoverPixel.y !== y || force) {
      this.drawPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel.color);

      this.hoverPixel = new HoverPixel(x, y, color || this.defaultColor, username);
      this.drawPixel(x, y, this.colorPalette[this.selectedColor]);
    }
  }

  private hideBubble() {
    const bubble = document.getElementById("bubble");

    if (bubble) {
      bubble.style.visibility = "hidden";
      bubble.style.opacity = "0";
      if (bubble.innerHTML.startsWith("Wait")) {
        bubble.innerHTML = "";
      }
    }
  }

  private showBubble(text: string, clientX: number, clientY: number) {
    const div = document.getElementById("bubble")!;
    if (div.innerHTML.startsWith("Wait")) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    div.innerHTML = text;

    let yOffset = div.clientHeight * 1.3;
    if (clientY - rect.top < yOffset) {
      yOffset = -20
    }
    let xOffset = div.clientWidth * 1.15;
    if (clientX - rect.left < rect.width - xOffset) {
      xOffset = -30
    }

    div.style.visibility = "visible";
    div.style.opacity = "1";
    div.style.left = `${clientX - xOffset}px`;
    div.style.top = `${clientY - yOffset}px`;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(this.hideBubble, 2000) as unknown as number;
  }

  private async loadBoard() {
    const limit = 100000;
    let offset = 0;
    let pixels;

    try {
      do {

        const result = await fetch(environment.endpointUrl + `/GetRange?offset=${offset}&limit=${limit}`);
        if (!result.ok) {
          alert("This site is currently under maintenance.");
          return;
        }

        pixels = await result.json();
        pixels.forEach((p: Pixel) => {
          if (p.placedBy == "") {
            p.placedBy = this.defaultUsername;
          }
          this.boardArr.push(p);
        });
        this.drawBoard();
        this.drawHoverPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel.color, this.hoverPixel.placedBy, true)
        this.updateLeaderboard();

        offset += limit;
      }
      while (pixels.length == limit);
    }
    catch (error: any) {
      if (error instanceof Error && !error.message.toLowerCase().includes('fetch')) {
        alert("An error occured while loading the canvas: " + error.message);
      }
    }
    this.isSliderVisible = true;
    this.setSliderToMax();

    try {
      const board = localStorage.getItem("board");
      if (board && JSON.parse(board).length >= this.boardArr.length) {
        return;
      }
      localStorage.setItem("board", JSON.stringify(this.boardArr));
    }
    catch {
      console.log("Could not save board array.")
    }
  }


  private setSliderToMax() {
    setTimeout(() => {
      this.sliderOptions = {
        ...this.sliderOptions,
        ceil: this.boardArr.length
      };
      this.sliderValue = this.sliderOptions.ceil
    });
  }

  private updateLeaderboard() {
    this.leaderboard = [];

    let max = this.boardArr.length;
    if (this.isSliderVisible) {
      max = this.sliderValue;
    }

    for (let i = 0; i < max; i++) {
      const pixel = this.boardArr[i];
      const existingEntry = this.leaderboard.find(item => item.name === pixel.placedBy);
      if (existingEntry) {
        existingEntry.placedPixels++;
      }
      else {
        this.leaderboard.push({ name: pixel.placedBy, placedPixels: 1 });
      }
    };

    const list = document.getElementById('leaderboard-list')!;
    list.innerHTML = '';
    this.leaderboard.sort((a, b) => b.placedPixels - a.placedPixels);

    for (let i = 0; i < Math.min(10, this.leaderboard.length); i++) {
      if (!this.userFilter || this.userFilter == this.leaderboard[i].name) {
        const position = i + 1;
        const percentage = (this.leaderboard[i].placedPixels / this.boardArr.length * 100).toFixed(2);

        const element = document.createElement('li');
        element.className = 'leaderboard-item';

        element.innerHTML = `
        <span class="position">${position}.</span>
        <span class="name">${this.leaderboard[i].name}</span>
        <span class="score"># ${this.leaderboard[i].placedPixels}<br></br>${percentage}%</span>
        `;
        list.appendChild(element);
      }
    }

  }

  public async onSliderChange() {
    clearTimeout(this.debounceTimeout);

    this.debounceTimeout = setTimeout(() => {
      this.drawBoard();
      this.updateLeaderboard();
    }, 1);
  }

  public onSliderStart(): void {
    this.sliderDragState = true;
  }

  public onSliderEnd(): void {
    this.sliderDragState = false;
  }

  private getValidPixelOrNull(x: number, y: number, c: any, placedBy: any, updatedAt: any) {
    if (x < 0 || x >= this.dimensions.width || y < 0 || y >= this.dimensions.height) {
      return null;
    }

    //Check if hex is valid
    const reg = /^[0-9A-F]{6}$/i;
    if (!c || !reg.test(c)) {
      c = this.defaultColor;
    }
    return new Pixel(x, y, c, placedBy, updatedAt);
  }

  private async sendPixel(x: number, y: number, color: string, e: MouseEvent) {
    const originalPixel = this.findLatestPixel(x, y);

    //Abort task if same pixel by same user already exits.
    if (originalPixel && originalPixel.color === color && originalPixel.placedBy === this.username) {
      return;
    }

    const newPixel = new Pixel(x, y, color, this.username, "")
    if (this.getIndex(newPixel) != -1) {
      return;
    }
    this.pixelQueue.push(newPixel)
    this.playSound();
    if (this.signalRService.getState() == HubConnectionState.Disconnecting || this.signalRService.getState() == HubConnectionState.Disconnected) {
      this.initSignalR();
    }
    try {
      const pixelToSend = {
        ...newPixel,
        timestamp: new Date()
      };

      const response = await fetch(environment.endpointUrl + "/SendPixel", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify(pixelToSend)
      })

      this.pixelQueue.splice(this.getIndex(newPixel), 1);

      if (response.ok) {
        this.increaseCounter();
        console.log('Success.');
      }
      else if (response.status === 429) {
        this.showBubble(`Wait ${response.headers.get("retry-after")} seconds.`, e.clientX, e.clientY);
        this.hoverPixel = new HoverPixel(-1, -1, "", "");
        this.drawBoard();
      }
    }
    catch (e) {
      this.pixelQueue.splice(this.getIndex(newPixel), 1);
      this.hoverPixel = new HoverPixel(-1, -1, "", "");
      this.drawBoard();
      console.log(e);
    }
  }


  private drawBoard() {
    let max = this.isSliderVisible ? this.sliderValue : this.boardArr.length;
    this.context.clearRect(0, 0, this.dimensions.width, this.dimensions.height)
    for (let i = 0; i < max; i++) {
      const p = this.boardArr[i];
      if (!this.userFilter || p.placedBy == this.userFilter) {
        this.drawPixel(p.x, p.y, p.color);
      }
    }
  }

  private drawPixel(x: number, y: number, c: string) {

    if (this.getValidPixelOrNull(x, y, c, null, null) == null) {
      return;
    }

    this.context.fillStyle = '#' + c;
    this.context.fillRect(x, y, 1, 1);
  }

  private resizeCanvas() {
    const max = Math.min(window.innerWidth, window.innerHeight / 1.2);
    this.canvas.style.width = max + 'px';
    this.canvas.style.height = max + 'px';

    const rect = this.canvas.getBoundingClientRect();
    const parentRect = this.canvas.parentElement.getBoundingClientRect();

    const offsetX = rect.left - parentRect.left;
    const offsetY = rect.top - parentRect.top;

    this.grid.style.left = `${offsetX}px`;
    this.grid.style.top = `${offsetY}px`;

    this.grid.style.width = this.canvas.style.width;
    this.grid.style.height = this.canvas.style.height;
  }

  public usernameChange(event: Event) {
    const val = (event.target as HTMLInputElement).value
    if (val.length > 16) {
      (event.target as HTMLInputElement).value = this.username;
      alert("Username cannot be longer than 16 characters.");
      return;
    }
    this.username = val;
    localStorage.setItem("username", val);
  }

  private onWheel(e: WheelEvent) {
    if (e.shiftKey || e.ctrlKey || e.altKey) {
      return;
    }
    this.panzoom.zoomWithWheel(e, { animate: true });
    this.savePanzoomState();
  }

  private savePanzoomState() {
    const pan = this.panzoom.getPan();
    const x = Math.round(pan.x);
    const y = Math.round(pan.y);

    const scale = Math.round(this.panzoom.getScale());

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { x: x, y: y, scale: scale },
      queryParamsHandling: 'merge'
    });

    localStorage.setItem('panzoomState', JSON.stringify({ x: x, y: y, scale }));
  }

  private restorePanzoomState() {
    const savedState = localStorage.getItem('panzoomState');
    if (!savedState) {
      return;
    }
    const state = JSON.parse(savedState);
    this.panzoom.zoom(state.scale);
    setTimeout(() => this.panzoom.pan(state.x, state.y))
  }

  private getIndex(p: Pixel): number {
    return this.pixelQueue.findIndex(item => item.x == p.x && item.y == p.y && item.color == p.color && item.placedBy == p.placedBy);
  }
}
